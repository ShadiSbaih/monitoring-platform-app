import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
export class EmailDto { @IsEmail() @MaxLength(254) email!: string; }
export class LoginDto extends EmailDto { @IsString() @MinLength(1) @MaxLength(128) password!: string; }
export class SignupDto extends LoginDto { @IsString() @MinLength(1) @MaxLength(100) name!: string; }
export class TokenDto { @IsString() @MinLength(32) @MaxLength(200) token!: string; }
export class ResetDto extends TokenDto { @IsString() @MinLength(12) @MaxLength(128) password!: string; }
export class RefreshDto { @IsString() @MinLength(32) @MaxLength(200) refreshToken!: string; }
