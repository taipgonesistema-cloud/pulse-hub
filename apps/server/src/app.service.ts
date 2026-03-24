import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'pulse-hub-server',
      timestamp: new Date().toISOString(),
    };
  }
}
