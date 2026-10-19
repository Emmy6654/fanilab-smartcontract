import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  scValToNative,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { ContractInvokeOptions } from '../types/common.types';
import { formatSorobanError } from './error-codes';

export type ScVal = xdr.ScVal;

export function address(value: string): ScVal {
  return new Address(value).toScVal();
}

export function u64(value: bigint | number): ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

export function u32(value: number): ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

export function i128(value: bigint): ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

export function bool(value: boolean): ScVal {
  return nativeToScVal(value);
}

export function symbol(value: string): ScVal {
  return xdr.ScVal.scvSymbol(value);
}

export function string(value: string): ScVal {
  return nativeToScVal(value);
}

export function bytes(value: Uint8Array): ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(value));
}

export function vec(values: ScVal[]): ScVal {
  return xdr.ScVal.scvVec(values);
}

export function map(fields: Array<[string, ScVal]>): ScVal {
  return xdr.ScVal.scvMap(
    fields.map(([key, value]) =>
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: value })
    )
  );
}

export function native(value: ScVal): unknown {
  return scValToNative(value);
}

function abortError(): Error {
  const error = new Error('Contract invocation was aborted');
  error.name = 'AbortError';
  return error;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function awaitPollResult<T>(
  request: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const finish = (complete: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), timeoutMs);
    const onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    request.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

export class ContractInvoker {
  private readonly contract: Contract;
  private readonly defaults: ContractInvokeOptions;

  constructor(contractId: string, defaults: ContractInvokeOptions = {}) {
    this.contract = new Contract(contractId);
    this.defaults = defaults;
  }

  async call(
    functionName: string,
    args: ScVal[],
    options: ContractInvokeOptions = {}
  ): Promise<unknown> {
    const config = { ...this.defaults, ...options };
    const server = this.server(config);
    const accountId = this.require(config.sourceAccount, 'sourceAccount');
    const networkPassphrase = this.require(config.networkPassphrase, 'networkPassphrase');
    const account = await server.getAccount(accountId);
    const transaction = new TransactionBuilder(account, {
      fee: config.fee ?? '100000',
      networkPassphrase,
    })
      .setTimeout(config.timeoutSeconds ?? 30)
      .addOperation(this.contract.call(functionName, ...args))
      .build();
    const prepared = await server.prepareTransaction(transaction);

    if (!config.signer) {
      const simulation = await server.simulateTransaction(transaction);
      if (SorobanRpc.Api.isSimulationError(simulation)) {
        throw new Error(formatSorobanError('Soroban simulation failed', simulation.error));
      }
      return simulation.result?.retval ? native(simulation.result.retval) : undefined;
    }

    prepared.sign(config.signer);
    const submitted = await server.sendTransaction(prepared);
    if (submitted.status === 'ERROR') {
      throw new Error(
        formatSorobanError(
          'Soroban submission failed',
          submitted.errorResult?.toString() ?? 'unknown error'
        )
      );
    }
    if (submitted.status === 'PENDING') {
      return this.waitForResult(server, submitted.hash, config);
    }
    return undefined;
  }

  private async waitForResult(
    server: SorobanRpc.Server,
    hash: string,
    config: ContractInvokeOptions
  ): Promise<unknown> {
    const initialDelay = config.pollingIntervalMs ?? 1000;
    const maxDelay = config.pollingMaxIntervalMs ?? 10_000;
    const timeout = config.pollingTimeoutMs ?? 300_000;
    if (!Number.isFinite(initialDelay) || initialDelay <= 0) {
      throw new RangeError('pollingIntervalMs must be a positive number');
    }
    if (!Number.isFinite(maxDelay) || maxDelay < initialDelay) {
      throw new RangeError('pollingMaxIntervalMs must be greater than or equal to pollingIntervalMs');
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError('pollingTimeoutMs must be a positive number');
    }

    const deadline = Date.now() + timeout;
    let interval = initialDelay;
    for (;;) {
      if (config.signal?.aborted) {
        throw abortError();
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Soroban transaction: ${hash}`);
      }
      const remaining = deadline - Date.now();
      const result = await awaitPollResult(
        server.getTransaction(hash),
        remaining,
        `Timed out waiting for Soroban transaction: ${hash}`,
        config.signal
      );
      if (result.status === 'SUCCESS') {
        return result.returnValue ? native(result.returnValue) : undefined;
      }
      if (result.status === 'FAILED') {
        const errorCodes = result.diagnosticEventsXdr?.flatMap(({ event }) => {
          const value = event.body.value.data;
          return value.type === 'scvError' && value.error.type === 'sceContract'
            ? [value.error.contractCode]
            : [];
        });
        const failure = errorCodes?.length
          ? `Error(Contract, #${errorCodes.join(', #')})`
          : hash;
        throw new Error(
          formatSorobanError('Soroban transaction failed', failure, errorCodes ?? [])
        );
      }
      const remainingAfterPoll = deadline - Date.now();
      if (remainingAfterPoll <= 0) {
        throw new Error(`Timed out waiting for Soroban transaction: ${hash}`);
      }
      await delay(Math.min(interval, remainingAfterPoll), config.signal);
      interval = Math.min(interval * 2, maxDelay);
    }
  }

  private server(config: ContractInvokeOptions): SorobanRpc.Server {
    return new SorobanRpc.Server(
      this.require(config.serverUrl, 'serverUrl'),
      {
        allowHttp: config.serverUrl?.startsWith('http://'),
        ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
      }
    );
  }

  private require<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
      throw new Error(`Contract invocation requires ${name}`);
    }
    return value;
  }
}

export type Signer = Keypair;
