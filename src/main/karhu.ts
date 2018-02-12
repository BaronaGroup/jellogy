import defaultConfigImpl from '../config/default'
import {Color} from 'ansi-styles'
import {logLevelsMatch} from './util'
import {enableStandardOutputCapture, toggleForceCaptureDisabled} from './capturer'

type Context = string
type LogLevel = string

type KarhuTransportFn = (toLog: any, logLevel: string, context: string, config: KarhuConfig) => void

export type KarhuTransport = Map<string, KarhuTransportFn>

export interface KarhuConfig {
  logLevels: string[]
  colors: {
    [logLevel: string]: Color | Color[]
  }
  outputFormat: string
  formatters: {
    [outputFormat: string]: (toLog: any[], logLevel: string, context: string, config: KarhuConfig, colorStart: string, colorEnd: string, transport: string) => any,
  }
  contextSpecificLogLevels: Map<string | RegExp, LogLevel>
  defaultLogLevel: LogLevel
  envVariablePrefix: string,
  outputMapper: (value: any, logLevel: string, context: string, toLog: any[]) => any,
  transports: Map<string, KarhuTransport>,
  formatNow: (config: KarhuConfig) => string | number
}

const noColor = {
  open: '',
  close: ''
}

export type LogFunction = (...toLog: any[]) => void

export interface KarhuLogger {
  error: LogFunction
  ERROR: LogFunction
  warn: LogFunction
  WARN: LogFunction
  info: LogFunction
  INFO: LogFunction
  debug: LogFunction
  DEBUG: LogFunction
}

let globalConfig: KarhuConfig | undefined

if (!globalConfig) globalConfig = loadConfig()

function loadConfig(newConfig: KarhuConfig | null = null): KarhuConfig {
  const config = newConfig || defaultConfigImpl
  if (!config.formatters[config.outputFormat]) throw new Error('There is no formatter for chosen output format')
  return config
}

export function configure(config: null | KarhuConfig) {
  globalConfig = loadConfig(config)
}

export interface Karhu<LogImpl> {
  context: (context: string) => LogImpl
  reconfigure: (newConfig: Partial<KarhuConfig>) => void
  getConfig: () => KarhuConfig
}

export const context = (activeContext: Context) => usingConfig(() => required(globalConfig)).context(activeContext)
export function getGlobalConfig() {
  return globalConfig
}

export function usingConfig<LogImpl = KarhuLogger>(configSource: KarhuConfig | (() => KarhuConfig)): Karhu<LogImpl> {
  const config = typeof configSource === 'function' ? configSource() : configSource

  return {
    context: forContext,
    reconfigure,
    getConfig: () => config
  }

  function forContext(activeContext: string) {
    const impl: any = {}
    for (const type of config.logLevels) {
      impl[type] = (...toLog: any[]) => logEvent(config, activeContext, type, toLog)
      const typeLower = type.toLowerCase()
      if (!impl[typeLower]) {
        impl[typeLower] = (...toLog: any[]) => logEvent(config, activeContext, type, toLog)
      }
    }

    return impl as LogImpl
  }

  function reconfigure(newConfig: Partial<KarhuConfig>) {
    if (newConfig.logLevels && !logLevelsMatch(config.logLevels, newConfig.logLevels)) {
      throw new Error('Log levels cannot be updated with reconfigure')
    }
    Object.assign(config, newConfig)
  }
}

function logEvent(config: KarhuConfig, activeContext: string, logLevel: string, toLog: any[]) {
  const eventLogPrio = config.logLevels.indexOf(logLevel),
    activeLogLevelPrio = config.logLevels.indexOf(getLogLevel(config, activeContext))

  if (eventLogPrio < activeLogLevelPrio) return

  for (const [transportName, transport] of config.transports.entries()) {
    const
      colorEnabled = isColorEnabled(config),
      color = colorEnabled ? config.colors[logLevel] || config.colors.default || noColor : noColor,
      openColor = asArray(color).map(c => c.open).join(''),
      closeColor = asArray(color).reverse().map(c => c.close).join(''),
      mappedValues = toLog.map(value => config.outputMapper(value, logLevel, activeContext, toLog)),
      outputImpl = transport.get(logLevel) || transport.get('default')

    if (!outputImpl) throw new Error('Transport ' + transportName + ' does not support log level ' + logLevel + ' or default')

    const formatted = config.formatters[config.outputFormat](mappedValues, logLevel, activeContext, config, openColor, closeColor, transportName)
    toggleForceCaptureDisabled(true)
    outputImpl(formatted, logLevel, activeContext, config)
    toggleForceCaptureDisabled(false)
  }
}

function getLogLevel(config: KarhuConfig, activeContext: Context) {
  return getOverrideLogLevel(config, activeContext) || getContextSpecificOverrideFromContext() || getOverrideLogLevel(config, null) || config.defaultLogLevel

  function getContextSpecificOverrideFromContext() {
    const perfectOverride = config.contextSpecificLogLevels.get(activeContext)
    if (perfectOverride) return perfectOverride
    for (const key of config.contextSpecificLogLevels.keys()) {
      if (key instanceof RegExp && key.test(activeContext)) {
        return config.contextSpecificLogLevels.get(key)
      }
    }
    return perfectOverride
  }
}

function getOverrideLogLevel(config: KarhuConfig, activeContext: Context | null) {
  const prefix = config.envVariablePrefix + '_LOG_LEVEL'
  return process.env[!activeContext ? prefix : prefix + '_' + toEnv(activeContext)]
}

function toEnv(activeContext: Context) {
  return activeContext.replace(/[^a-zA-Z0-9]+/g, '_')
}

function required<T>(val: T | undefined): T {
  if (!val) throw new Error('Required value missing')
  return val
}

function asArray<T>(inVal: T | T[]): T[] {
  if (inVal instanceof Array) return inVal
  return [inVal]
}

function isColorEnabled(config: KarhuConfig) {
  const override = process.env[config.envVariablePrefix + '_COLOR']
  if (override === '0' || override === 'false') return false
  if (override === '1' || override === 'true') return true
  return !!(process.stdout && process.stdout.isTTY)
}

export const captureStandardOutput = (logger: KarhuLogger, stdoutLogLevel = 'INFO', stderrLogLevel = 'ERROR') => {
  if (!logger) throw new Error('Please provide a logger in the proper context to captureStandardOutput')
  return enableStandardOutputCapture(logger, stdoutLogLevel, stderrLogLevel)
}
