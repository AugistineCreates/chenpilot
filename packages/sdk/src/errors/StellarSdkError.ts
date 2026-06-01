import { StellarErrorDetails } from "./types";

export class StellarSdkError extends Error {
  public readonly code: string;
  public readonly action?: string;
  public readonly rawCode?: string;

  constructor(details: StellarErrorDetails) {
    super(details.message);

    this.name = "StellarSdkError";
    this.code = details.code;
    this.action = details.action;
    this.rawCode = details.rawCode;
  }
}
