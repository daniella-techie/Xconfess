import { ApiProperty } from '@nestjs/swagger';

export class StellarContractIdsDto {
  @ApiProperty({
    description: 'Deployed confession-anchor Soroban contract ID',
    nullable: true,
    example: 'CBFR2MDZBQPTNBIJCT32MTDDQLW2AQNDWNO777F3QT6ANYKTHETQZWD3',
  })
  confessionAnchor: string | null;

  @ApiProperty({
    description: 'Deployed reputation-badges Soroban contract ID',
    nullable: true,
    example: 'CDD7WPESW54SN6YTXY7PH6JLG6S4MWNREHN5FD6XENAITEDOVLWKIQTC',
  })
  reputationBadges: string | null;

  @ApiProperty({
    description: 'Deployed tipping-system Soroban contract ID',
    nullable: true,
    example: 'CAJK27UHTBUGQFUMN5TG5LOQXYODT6NHOY7Z5DVRRMR7CZ4SCIZUE5A3',
  })
  tippingSystem: string | null;
}

/** Safe, public Stellar deployment summary for diagnostics (no secrets). */
export class StellarConfigResponseDto {
  @ApiProperty({
    description: 'Configured Stellar network',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: string;

  @ApiProperty({
    description: 'Horizon REST base URL for the configured network',
    example: 'https://horizon-testnet.stellar.org',
  })
  horizonUrl: string;

  @ApiProperty({
    description: 'Soroban RPC base URL for the configured network',
    example: 'https://soroban-rpc-testnet.stellar.org',
  })
  sorobanRpcUrl: string;

  @ApiProperty({ type: StellarContractIdsDto })
  contractIds: StellarContractIdsDto;
}
