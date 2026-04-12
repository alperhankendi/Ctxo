import { getConfig } from './config';

export class PaymentService {
  private readonly endpoint = 'https://10.0.0.50:8443/api';

  process(amount: number): boolean {
    const config = getConfig();
    return amount > 0;
  }
}
