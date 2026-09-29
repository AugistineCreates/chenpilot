export enum CallbackAction {
  SELECT_FROM_ASSET = "sf",
  SELECT_TO_ASSET = "st",
  CONFIRM_SWAP = "cs",
  CANCEL_SWAP = "xs",
  CONFIRM_MULTISIG = "cm",
  CANCEL_MULTISIG = "xm",
  SET_THRESHOLD = "th",
  SET_WEIGHT = "sw",
  CONFIRM = "ok",
  CANCEL = "no",
  BACK = "bk",
  SKIP = "sk",
  SELECT_OPTION = "so",
}

export interface TypedCallback<T = Record<string, unknown>> {
  action: CallbackAction;
  payload?: T;
}

const SEP = ":";
const MAX_CALLBACK_BYTES = 64;

export function packCallback(
  action: CallbackAction,
  payload?: Record<string, unknown>
): string {
  let packed: string;

  if (payload && Object.keys(payload).length > 0) {
    packed = `${action}${SEP}${JSON.stringify(payload)}`;
  } else {
    packed = action;
  }

  const byteLength = Buffer.byteLength(packed, "utf-8");
  if (byteLength > MAX_CALLBACK_BYTES) {
    throw new Error(
      `Callback data exceeds Telegram's ${MAX_CALLBACK_BYTES}-byte limit ` +
        `(got ${byteLength} bytes). Shorten payload keys/values. ` +
        `Data: ${packed}`
    );
  }

  return packed;
}

export function unpackCallback(data: string): TypedCallback | null {
  if (!data || typeof data !== "string") return null;

  const sepIdx = data.indexOf(SEP);
  const actionCode = sepIdx === -1 ? data : data.slice(0, sepIdx);

  const validActions = new Set(Object.values(CallbackAction) as string[]);
  if (!validActions.has(actionCode)) return null;

  const action = actionCode as CallbackAction;

  if (sepIdx === -1 || sepIdx === data.length - 1) {
    return { action };
  }

  const payloadStr = data.slice(sepIdx + 1);

  try {
    const payload = JSON.parse(payloadStr);
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return { action };
    }
    return { action, payload };
  } catch {
    return { action };
  }
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export function inlineBtn(
  text: string,
  action: CallbackAction,
  payload?: Record<string, unknown>
): InlineButton {
  return {
    text,
    callback_data: packCallback(action, payload),
  };
}

export function inlineKeyboard(rows: InlineButton[][]): {
  reply_markup: { inline_keyboard: InlineButton[][] };
} {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}
