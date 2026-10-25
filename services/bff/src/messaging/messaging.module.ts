import { Global, Module } from '@nestjs/common';
import { AmqpService } from './amqp.service';

@Global()
@Module({ providers: [AmqpService], exports: [AmqpService] })
export class MessagingModule {}
