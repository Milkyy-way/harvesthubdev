// A pod invite link opened by someone who isn't signed in yet: the route guard
// sends them to sign in or sign up, so the code waits here and the accept
// screen opens once they're in (app/_layout.tsx). In memory only: if the app
// is closed in between, they can type the code in under Neighborhood Pods.
let pendingCode: string | null = null;

export function rememberPodInvite(code: string): void {
  pendingCode = code;
}

export function takePodInvite(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}
