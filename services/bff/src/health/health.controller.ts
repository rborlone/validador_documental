import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { AmqpService } from '../messaging/amqp.service';

/**
 * Probes. Readiness solo depende de RabbitMQ (necesario para SSE); documents-service no se
 * incluye para no sacar de servicio todas las réplicas del BFF por una falla aguas abajo.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly amqp: AmqpService,
  ) {}

  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => {
        const check = this.indicator.check('rabbitmq');
        return this.amqp.isConnected() ? check.up() : check.down({ message: 'Sin conexión a RabbitMQ' });
      },
    ]);
  }
}
