import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import { Contact } from "./contact.entity";
import AppDataSource from "../config/Datasource";

@injectable()
export default class ContactService {
  private contactRepository: Repository<Contact>;

  constructor() {
    this.contactRepository = AppDataSource.getRepository(Contact);
  }

  async createContact(
    payload: { name: string; address: string; tokenType: string },
    userId: string
  ): Promise<Contact> {
    const contact = this.contactRepository.create({
      ...payload,
      userId,
    });
    return this.contactRepository.save(contact);
  }

  async deleteContact(id: string): Promise<void> {
    await this.contactRepository.delete(id);
  }

  async getAllContacts(): Promise<Contact[]> {
    return this.contactRepository.find();
  }
  async getContactByName(name: string): Promise<Contact | null> {
    return this.contactRepository.findOne({ where: { name } });
  }
}
