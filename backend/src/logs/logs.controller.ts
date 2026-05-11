import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PinoLogger } from "nestjs-pino";
import type { Request } from "express";
import { CreateLogDto } from "./dto/create-log.dto";

@ApiTags("logs")
@Controller("logs")
export class LogsController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext("ClientLog");
  }

  @Post()
  @HttpCode(204)
  @ApiOperation({ summary: "Ingest a client-side log event into server logs" })
  ingest(@Body() dto: CreateLogDto, @Req() req: Request): void {
    const cfIp = req.headers["cf-connecting-ip"];
    const xff = req.headers["x-forwarded-for"];
    const ip =
      (Array.isArray(cfIp) ? cfIp[0] : cfIp) ??
      (typeof xff === "string" ? xff.split(",")[0].trim() : undefined) ??
      req.ip;

    const payload = {
      source: "frontend",
      event: dto.event,
      ip,
      userAgent: req.headers["user-agent"],
      ...(dto.context ?? {}),
    };

    this.logger[dto.level](payload, dto.message);
  }
}
