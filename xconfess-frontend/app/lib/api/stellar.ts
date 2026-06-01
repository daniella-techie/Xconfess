import apiClient from './client';
import type { StellarConfigResponse } from '../types/stellar';

export async function fetchStellarConfig(): Promise<StellarConfigResponse> {
  const response = await apiClient.get<StellarConfigResponse>('/stellar/config');
  return response.data;
}
