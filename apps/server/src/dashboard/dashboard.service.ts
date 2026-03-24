import { Injectable } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class DashboardService {
  constructor(private readonly whatsappService: WhatsappService) {}

  async getOverview() {
    return this.whatsappService.getOverview();
  }
}
