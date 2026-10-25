import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DOCUMENT_TYPES } from '../document.types';

export class ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(200, { message: 'limit no puede superar 200' })
  limit?: number;
}

export class DocumentSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty({ example: 'application/pdf' }) contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, enum: DOCUMENT_TYPES }) expectedType!: string | null;
  @ApiProperty({ nullable: true, type: String }) documentType!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['VALID', 'INVALID', 'REVIEW'] }) verdict!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DocumentErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}

export class DocumentDetailDto extends DocumentSummaryDto {
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true, description: 'ValidationResult (contracts/validation-result.schema.json)' })
  result!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: DocumentErrorDto }) error!: DocumentErrorDto | null;
}

export class UploadResponseDto {
  @ApiProperty({ type: [DocumentSummaryDto] }) documents!: DocumentSummaryDto[];
}

export class ListResponseDto {
  @ApiProperty({ type: [DocumentSummaryDto] }) items!: DocumentSummaryDto[];
}
