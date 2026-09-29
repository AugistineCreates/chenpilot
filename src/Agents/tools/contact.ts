import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { container } from "tsyringe";
import ContactService from "../../Contacts/contact.service";
import { supportedTokens } from "../types";
import logger from "../../config/logger";

interface CreatePayload {
  name: string;
  tokenType: supportedTokens;
  address: string;
}

interface DeletePayload {
  id: string;
}

/**
 * Tool for managing contacts: create, list, and delete saved addresses
 */
export class ContactTool extends BaseTool {
  metadata: ToolMetadata = {
    name: "contact_tool",
    description: "Manage contacts: create, list, and delete contacts.",
    parameters: {
      operation: {
        type: "string",
        description: "The contact operation to perform",
        required: true,
        enum: ["create", "list", "delete"],
      },
      payload: {
        type: "object",
        description: "Payload for the operation",
        required: false,
      },
    },
    examples: [
      "save this address 0x123 as my_btc_wallet",
      "list all my contacts",
      "remove my_btc_wallet from my contact list",
    ],
    category: "contacts",
    version: "1.0.0",
    riskLevel: "medium",
    capabilities: ["contact_management"],
    permissions: ["user"],
  };

  private contactService = container.resolve(ContactService);

  /**
   * Execute a contact operation
   * @param payload - The operation payload containing operation type and data
   * @param userId - The user requesting the operation
   * @returns ToolResult with contact operation outcome
   */
  async execute(
    payload: Record<string, unknown>,
    userId: string
  ): Promise<ToolResult> {
    const operation = payload.operation as string;
    const data = payload.payload as CreatePayload & DeletePayload;

    try {
      switch (operation) {
        case "create":
          return this.createContact(data, userId);
        case "list":
          return this.listContacts(userId);
        case "delete":
          return this.deleteContact(data, userId);
        default:
          return this.createErrorResult(
            "contact_operation",
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult("contact_error", (error as Error).message);
    }
  }

  /**
   * Create a new contact
   * @param data - Contact data with name, address, and token type
   * @param userId - The user creating the contact
   * @returns ToolResult with created contact info
   */
  private async createContact(
    data: CreatePayload,
    userId: string
  ): Promise<ToolResult> {
    logger.info("Creating contact", {
      name: data?.name,
      tokenType: data?.tokenType,
      userId,
    });
    if (!data?.name || !data?.address || !data?.tokenType) {
      return this.createErrorResult(
        "create_contact",
        "Missing required fields: name, address, tokenType"
      );
    }

    const created = await this.contactService.createContact(data, userId);
    return this.createSuccessResult("contact_created", { created });
  }

  /**
   * List all contacts for the user
   * @param userId - The user requesting contact list
   * @returns ToolResult with contacts array
   */
  private async listContacts(userId: string): Promise<ToolResult> {
    const contacts = await this.contactService.getAllContacts();
    return this.createSuccessResult("contacts_list", { contacts });
  }

  /**
   * Delete a contact by ID
   * @param data - Payload containing the contact ID to delete
   * @param userId - The user requesting deletion
   * @returns ToolResult confirming deletion
   */
  private async deleteContact(
    data: DeletePayload,
    userId: string
  ): Promise<ToolResult> {
    if (!data?.id) {
      return this.createErrorResult(
        "delete_contact",
        "Missing required field: id"
      );
    }

    await this.contactService.deleteContact(data.id);
    return this.createSuccessResult("contact_deleted", { id: data.id });
  }
}

export const contactTool = new ContactTool();
