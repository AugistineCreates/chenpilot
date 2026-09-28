export type AllowanceStatus = "active" | "revoked";
export type ReservationStatus = "reserved" | "settled" | "released";

export interface WalletAllowanceGrant {
  id: string;
  walletId: string;
  asset: string;
  periodStart: Date;
  periodEnd: Date;
  amount: string;
  status: AllowanceStatus;
}

export interface WalletAllowanceReservation {
  id: string;
  grantId: string;
  workflowId: string;
  transactionId?: string;
  amount: string;
  status: ReservationStatus;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AllowanceReservationError extends Error {}

const toUnits = (amount: string): bigint => {
  if (!/^\d+$/.test(amount)) {
    throw new AllowanceReservationError("Allowance amounts must be integer asset units");
  }
  return BigInt(amount);
};

export class WalletAllowanceService {
  private grants = new Map<string, WalletAllowanceGrant>();
  private reservations = new Map<string, WalletAllowanceReservation>();
  private locks = new Map<string, Promise<void>>();

  async createGrant(grant: WalletAllowanceGrant): Promise<WalletAllowanceGrant> {
    this.grants.set(grant.id, { ...grant });
    return { ...grant };
  }

  revokeGrant(grantId: string): WalletAllowanceGrant {
    const grant = this.requireGrant(grantId);
    grant.status = "revoked";
    this.grants.set(grantId, grant);
    return { ...grant };
  }

  async reserve(params: {
    grantId: string;
    walletId: string;
    asset: string;
    amount: string;
    workflowId: string;
    transactionId?: string;
    now?: Date;
  }): Promise<WalletAllowanceReservation> {
    return this.withGrantLock(params.grantId, async () => {
      const now = params.now ?? new Date();
      const grant = this.requireGrant(params.grantId);
      this.assertGrantReservable(grant, params.walletId, params.asset, now);

      const requested = toUnits(params.amount);
      if (requested <= 0n) {
        throw new AllowanceReservationError("Reservation amount must be positive");
      }

      const reserved = this.getActiveReservedAmount(grant.id);
      const limit = toUnits(grant.amount);
      if (reserved + requested > limit) {
        throw new AllowanceReservationError("Allowance exceeded");
      }

      const reservation: WalletAllowanceReservation = {
        id: crypto.randomUUID(),
        grantId: grant.id,
        workflowId: params.workflowId,
        transactionId: params.transactionId,
        amount: params.amount,
        status: "reserved",
        createdAt: now,
        updatedAt: now,
      };
      this.reservations.set(reservation.id, reservation);
      return { ...reservation };
    });
  }

  settle(reservationId: string, reason = "settled"): WalletAllowanceReservation {
    return this.transition(reservationId, "settled", reason);
  }

  release(reservationId: string, reason = "released"): WalletAllowanceReservation {
    return this.transition(reservationId, "released", reason);
  }

  listReservations(grantId: string): WalletAllowanceReservation[] {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.grantId === grantId)
      .map((reservation) => ({ ...reservation }));
  }

  getAuditSnapshot(grantId: string): {
    grant: WalletAllowanceGrant;
    reserved: string;
    settled: string;
    released: string;
    reservations: WalletAllowanceReservation[];
  } {
    const grant = this.requireGrant(grantId);
    const reservations = this.listReservations(grantId);
    const sum = (status: ReservationStatus) =>
      reservations
        .filter((reservation) => reservation.status === status)
        .reduce((total, reservation) => total + toUnits(reservation.amount), 0n)
        .toString();

    return {
      grant: { ...grant },
      reserved: sum("reserved"),
      settled: sum("settled"),
      released: sum("released"),
      reservations,
    };
  }

  private transition(
    reservationId: string,
    status: ReservationStatus,
    reason: string,
  ): WalletAllowanceReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new AllowanceReservationError("Reservation not found");
    if (reservation.status !== "reserved") {
      throw new AllowanceReservationError(`Reservation already ${reservation.status}`);
    }
    const updated = { ...reservation, status, reason, updatedAt: new Date() };
    this.reservations.set(reservationId, updated);
    return { ...updated };
  }

  private getActiveReservedAmount(grantId: string): bigint {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.grantId === grantId && reservation.status === "reserved")
      .reduce((total, reservation) => total + toUnits(reservation.amount), 0n);
  }

  private assertGrantReservable(
    grant: WalletAllowanceGrant,
    walletId: string,
    asset: string,
    now: Date,
  ): void {
    if (grant.status !== "active") throw new AllowanceReservationError("Allowance grant is revoked");
    if (grant.walletId !== walletId) throw new AllowanceReservationError("Wallet does not match grant");
    if (grant.asset !== asset) throw new AllowanceReservationError("Asset does not match grant");
    if (now < grant.periodStart || now >= grant.periodEnd) {
      throw new AllowanceReservationError("Allowance grant is expired");
    }
  }

  private requireGrant(grantId: string): WalletAllowanceGrant {
    const grant = this.grants.get(grantId);
    if (!grant) throw new AllowanceReservationError("Allowance grant not found");
    return { ...grant };
  }

  private async withGrantLock<T>(grantId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(grantId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(grantId, previous.then(() => current));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(grantId) === current) this.locks.delete(grantId);
    }
  }
}

export const walletAllowanceService = new WalletAllowanceService();
