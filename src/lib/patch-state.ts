// Global flag tracking whether `import 'inference-relay/auto'` ran in this
// process. Once loaded, the SDK prototypes are patched globally — see
// https://inference-relay.com/docs for the public mechanism description.
export const patchState = { autopatchLoaded: false };
