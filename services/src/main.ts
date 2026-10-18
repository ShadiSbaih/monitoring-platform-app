import 'dotenv/config';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PORT } from './configs';
import { BodyParserExceptionFilter } from './filters/body-parser-exception.filter';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('json', { limit: '272kb' });
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({ origin: (process.env.FRONTEND_ORIGINS ?? process.env.APP_URL ?? 'http://localhost:3001').split(',').map(s => s.trim()),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new BodyParserExceptionFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? PORT), '0.0.0.0');
}
void bootstrap();
