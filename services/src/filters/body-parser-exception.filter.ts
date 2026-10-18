import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

interface BodyParserException extends Error {
  type?: string;
}

@Catch()
export class BodyParserExceptionFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if ((exception as BodyParserException)?.type === 'entity.too.large') {
      const response = host.switchToHttp().getResponse();
      response.status(413).json({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'The request body exceeds the allowed size.',
      });
      return;
    }

    super.catch(exception, host);
  }
}
