export const SUPPORTED_API_VERSIONS = ['1', '2'] as const;

export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

/** @deprecated Use SUPPORTED_API_VERSIONS. Stays '1' so plugins that declare it keep loading on older cores. */
export const SUPPORTED_API_VERSION = '1' as const;
