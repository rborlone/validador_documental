import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsHub } from './notifications.hub';

@Module({
  controllers: [EventsController],
  providers: [NotificationsHub, NotificationsConsumer],
  exports: [NotificationsHub],
})
export class NotificationsModule {}
