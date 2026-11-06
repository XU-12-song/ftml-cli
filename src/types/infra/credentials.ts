/**
 * credentials.ts — Wikidot 凭证类型
 */

/** 凭证来源：环境变量 / 凭证文件 */
export type CredentialSource = 'env' | 'file';

/** 读取到的凭证 */
export interface Credentials {
  username: string;
  password: string;
  source: CredentialSource;
}

/** 待保存的凭证 */
export interface CredentialInput {
  username: string;
  password: string;
}
