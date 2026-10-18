import { ArrayNotEmpty, IsArray, IsObject } from 'class-validator';

export class SendLogsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsObject({ each: true })
  logs!: Record<string, unknown>[];
}
