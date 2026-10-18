import { IsIn } from 'class-validator';
import { PlanTier } from '../../configs';

export class CreateCheckoutDto {
  @IsIn([PlanTier.STARTER, PlanTier.PRO, PlanTier.BUSINESS])
  selectedPlan!: PlanTier.STARTER | PlanTier.PRO | PlanTier.BUSINESS;
}
