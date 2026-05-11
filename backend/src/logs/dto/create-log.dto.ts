import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateLogDto {
  @IsIn(["error", "warn", "info"])
  level!: "error" | "warn" | "info";

  @IsString()
  @MaxLength(120)
  event!: string;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
