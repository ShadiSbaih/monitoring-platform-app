import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsObject, IsOptional, IsUUID } from 'class-validator';
export class SendLogsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsObject({ each: true })
  logs!: Record<string, unknown>[];
  @IsOptional() @IsUUID() batchId?: string;
}
