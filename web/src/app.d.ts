// See https://svelte.dev/docs/kit/types#app
// for information about these interfaces
import type { SessionUser } from './hooks.server';

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user?: SessionUser;
    }
    interface PageData {
      user?: SessionUser;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
