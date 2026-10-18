import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const conditionFields = ['type', 'message', 'importance', 'environment', 'service', 'subsystem', 'operation'];

export class AlertConditionDto {
  @IsIn(conditionFields)
  field!: string;

  @IsIn(['equals', 'not_equals'])
  operator!: string;

  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class AlertThresholdDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  window_minutes!: number;
}

export class CreateAlertDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  app_name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AlertConditionDto)
  conditions!: AlertConditionDto[];

  @ValidateNested()
  @Type(() => AlertThresholdDto)
  threshold!: AlertThresholdDto;

  @IsString()
  @IsNotEmpty()
  webhook_url!: string;

  @IsString()
  @IsNotEmpty()
  cooldown_period!: string;

  @IsString()
  @IsNotEmpty()
  summary!: string;
}

export class VerifyWebhookDto {
  @Type(() => Number)
  @IsInt()
  timestamp!: number;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsDefined()
  body!: unknown;
}
