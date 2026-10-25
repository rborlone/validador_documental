import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorService, PrismaHealthIndicator } from '@nestjs/terminus';
import { AmqpService } from '../messaging/amqp.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpService,
  ) {}

  /** Liveness: el proceso responde. No depende de servicios externos para evitar reinicios en cascada. */
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Readiness: PostgreSQL y RabbitMQ disponibles. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('postgres', this.prisma, { timeout: 2000 }),
      () => {
        const check = this.indicator.check('rabbitmq');
        return this.amqp.isConnected() ? check.up() : check.down({ message: 'Sin conexión a RabbitMQ' });
      },
    ]);
  }
}
