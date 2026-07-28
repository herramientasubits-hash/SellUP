/**
 * Q3F-5BB.11B — Pure provider-routing core (barrel).
 *
 * Pure module: no runtime wiring, no env, no provider calls, no DB. Exposes the
 * declarative registry, the pure resolver, and the plan contract types.
 */

export * from './types';
export {
  DEFAULT_PROVIDER_REGISTRY,
  getProviderDescriptor,
} from './provider-registry';
export {
  resolveProviderRoutingPlan,
  DEFAULT_MIN_USEFUL_CANDIDATES,
} from './resolve-provider-routing-plan';
