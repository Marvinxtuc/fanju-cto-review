export interface ServiceFeePricingInput {
  serviceFeeCents: number;
}

export function calculateOrderAmountCents({
  serviceFeeCents,
}: ServiceFeePricingInput): number {
  if (!Number.isInteger(serviceFeeCents) || serviceFeeCents <= 0) {
    throw new Error("serviceFeeCents must be a positive integer");
  }

  return serviceFeeCents;
}
