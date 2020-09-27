import {
  IServiceLocator,
  Reporter,
  IIndexable,
  PLATFORM,
} from '@aurelia/kernel';
import {
  IForOfStatement,
  IsBindingBehavior,
  IAccessMemberExpression,
  IExpression,
  IAccessKeyedExpression,
  IAccessScopeExpression,
} from '../ast';
import {
  BindingMode,
  ExpressionKind,
  LifecycleFlags,
  State,
} from '../flags';
import { ILifecycle } from '../lifecycle';
import {
  AccessorOrObserver,
  IBindingTargetObserver,
  IScope,
  PropertyObserver,
} from '../observation';
import { IObserverLocator } from '../observation/observer-locator';
import {
  hasBind,
  hasUnbind,
} from './ast';
import {
  connectable,
  IConnectableBinding,
  IPartialConnectableBinding,
} from './connectable';
import { BindingContext } from '../observation/binding-context';

// BindingMode is not a const enum (and therefore not inlined), so assigning them to a variable to save a member accessor is a minor perf tweak
const { oneTime, toView, fromView } = BindingMode;

// pre-combining flags for bitwise checks is a minor perf tweak
const toViewOrOneTime = toView | oneTime;

export interface PropertyBinding extends IConnectableBinding {}

@connectable()
export class PropertyBinding implements IPartialConnectableBinding {
  public interceptor: this = this;

  public id!: number;
  public $state: State = State.none;
  public $lifecycle: ILifecycle;
  public $scope?: IScope = void 0;
  public part?: string;

  public targetObserver?: AccessorOrObserver = void 0;;

  public persistentFlags: LifecycleFlags = LifecycleFlags.none;

  public constructor(
    public sourceExpression: IsBindingBehavior | IForOfStatement,
    public target: object,
    public targetProperty: string,
    public mode: BindingMode,
    public observerLocator: IObserverLocator,
    public locator: IServiceLocator,
  ) {
    connectable.assignIdTo(this);
    this.$lifecycle = locator.get(ILifecycle);
  }

  public updateTarget(value: unknown, flags: LifecycleFlags): void {
    flags |= this.persistentFlags;
    this.targetObserver!.setValue(value, flags);
  }

  public updateSource(value: unknown, flags: LifecycleFlags): void {
    flags |= this.persistentFlags;
    this.sourceExpression.assign!(flags, this.$scope!, this.locator, value, this.part);
  }

  public handleChange(newValue: unknown, _previousValue: unknown, flags: LifecycleFlags): void {
    if ((this.$state & State.isBound) === 0) {
      return;
    }

    flags |= this.persistentFlags;

    if ((flags & LifecycleFlags.updateTargetInstance) > 0) {
      const previousValue = this.targetObserver!.getValue();
      const canOptimize = this.sourceExpression.$kind !== ExpressionKind.AccessScope || this.observerSlots > 1;
      // if the only observable is an AccessScope then we can assume the passed-in newValue is the correct and latest value
      if (!canOptimize) {
        newValue = this.sourceExpression.evaluate(flags, this.$scope!, this.locator, this.part);
      }
      if (newValue !== previousValue) {
        this.interceptor.updateTarget(newValue, flags);
      }
      if ((this.mode & oneTime) === 0 && !canOptimize) {
        this.version++;
        this.sourceExpression.connect(flags, this.$scope!, this.interceptor, this.part);
        this.interceptor.unobserve(false);
      }
      return;
    }

    if ((flags & LifecycleFlags.updateSourceExpression) > 0) {
      if (newValue !== this.sourceExpression.evaluate(flags, this.$scope!, this.locator, this.part)) {
        this.interceptor.updateSource(newValue, flags);
      }
      return;
    }

    throw Reporter.error(15, flags);
  }

  public $bind(flags: LifecycleFlags, scope: IScope, part?: string): void {
    if (this.$state & State.isBound) {
      if (this.$scope === scope) {
        return;
      }
      this.interceptor.$unbind(flags | LifecycleFlags.fromBind);
    }
    // add isBinding flag
    this.$state |= State.isBinding;
    // Force property binding to always be strict
    flags |= LifecycleFlags.isStrictBindingStrategy;

    // Store flags which we can only receive during $bind and need to pass on
    // to the AST during evaluate/connect/assign
    this.persistentFlags = flags & LifecycleFlags.persistentBindingFlags;

    this.$scope = scope;
    this.part = part;

    let sourceExpression = this.sourceExpression;
    if (hasBind(sourceExpression)) {
      sourceExpression.bind(flags, scope, this.interceptor);
    }

    let targetObserver = this.targetObserver as IBindingTargetObserver | undefined;
    if (!targetObserver) {
      if (this.mode & fromView) {
        targetObserver = this.targetObserver = this.observerLocator.getObserver(flags, this.target, this.targetProperty) as IBindingTargetObserver;
      } else {
        targetObserver = this.targetObserver = this.observerLocator.getAccessor(flags, this.target, this.targetProperty) as IBindingTargetObserver;
      }
    }
    if (this.mode !== BindingMode.oneTime && targetObserver.bind) {
      targetObserver.bind(flags);
    }

    // during bind, binding behavior might have changed sourceExpression
    sourceExpression = this.sourceExpression;
    if (this.mode & toViewOrOneTime) {
      this.interceptor.updateTarget(sourceExpression.evaluate(flags, scope, this.locator, part), flags);
    }
    if (this.mode & toView) {
      sourceExpression.connect(flags, scope, this.interceptor, part);
    }
    if (this.mode & fromView) {
      targetObserver.subscribe(this.interceptor);
      if ((this.mode & toView) === 0) {
        this.interceptor.updateSource(targetObserver.getValue(), flags);
      }
      (targetObserver as typeof targetObserver & { [key: string]: number })[this.id] |= LifecycleFlags.updateSourceExpression;
    }

    // add isBound flag and remove isBinding flag
    this.$state |= State.isBound;
    this.$state &= ~State.isBinding;
  }

  public $unbind(flags: LifecycleFlags): void {
    if (!(this.$state & State.isBound)) {
      return;
    }
    // add isUnbinding flag
    this.$state |= State.isUnbinding;

    // clear persistent flags
    this.persistentFlags = LifecycleFlags.none;

    if (hasUnbind(this.sourceExpression)) {
      this.sourceExpression.unbind(flags, this.$scope!, this.interceptor);
    }
    this.$scope = void 0;

    if ((this.targetObserver as IBindingTargetObserver).unbind) {
      (this.targetObserver as IBindingTargetObserver).unbind!(flags);
    }
    if ((this.targetObserver as IBindingTargetObserver).unsubscribe) {
      (this.targetObserver as IBindingTargetObserver).unsubscribe(this.interceptor);
      (this.targetObserver as this['targetObserver'] & { [key: number]: number })[this.id] &= ~LifecycleFlags.updateSourceExpression;
    }
    this.interceptor.unobserve(true);

    // remove isBound and isUnbinding flags
    this.$state &= ~(State.isBound | State.isUnbinding);
  }
}

export interface OptimizedPropertyBinding extends IConnectableBinding {}

@connectable()
export class OptimizedPropertyBinding implements IPartialConnectableBinding {

  public id!: number;
  public $state: State = State.none;
  public $scope?: IScope = void 0;
  public part?: string;

  public targetObserver?: AccessorOrObserver = void 0;;

  public persistentFlags: LifecycleFlags = LifecycleFlags.none;
  public observers: PropertyObserver[] | null = null;
  public subscribers: OptimizedSubscriber[] = [];

  public constructor(
    public sourceExpression: IsBindingBehavior | IForOfStatement,
    public target: object,
    public targetProperty: string,
    public observerLocator: IObserverLocator,
    public locator: IServiceLocator,
  ) {
    connectable.assignIdTo(this);
  }

  // public updateTarget(value: unknown, flags: LifecycleFlags): void {
  //   flags |= this.persistentFlags;
  //   this.targetObserver!.setValue(value, flags);
  // }

  // public updateSource(value: unknown, flags: LifecycleFlags): void {
  //   flags |= this.persistentFlags;
  //   this.sourceExpression.assign!(flags, this.$scope!, this.locator, value, this.part);
  // }

  // public handleChange(newValue: unknown, _previousValue: unknown, flags: LifecycleFlags): void {
  //   if ((this.$state & State.isBound) === 0) {
  //     return;
  //   }

  //   flags |= this.persistentFlags;

  //   const previousValue = this.targetObserver!.getValue();
  //   const canOptimize = this.sourceExpression.$kind !== ExpressionKind.AccessScope || this.observerSlots > 1;
  //   // if the only observable is an AccessScope then we can assume the passed-in newValue is the correct and latest value
  //   if (!canOptimize) {
  //     newValue = this.sourceExpression.evaluate(flags, this.$scope!, this.locator, this.part);
  //   }
  //   if (newValue !== previousValue) {
  //     this.targetObserver!.setValue(newValue, flags | this.persistentFlags);
  //   }
  //   // if ((this.mode & oneTime) === 0 && !canOptimize) {
  //   //   this.version++;
  //   //   this.sourceExpression.connect(flags, this.$scope!, this, this.part);
  //   //   this.unobserve(false);
  //   // }
  //   return;
  // }

  public $bind(flags: LifecycleFlags, scope: IScope, part?: string): void {
    if (this.$state & State.isBound) {
      if (this.$scope === scope) {
        return;
      }
      this.$unbind(flags | LifecycleFlags.fromBind);
    }
    // add isBinding flag
    this.$state |= State.isBinding;
    // Force property binding to always be strict
    flags |= LifecycleFlags.isStrictBindingStrategy;

    // Store flags which we can only receive during $bind and need to pass on
    // to the AST during evaluate/connect/assign
    this.persistentFlags = flags & LifecycleFlags.persistentBindingFlags;

    this.$scope = scope;
    this.part = part;

    // let sourceExpression = this.sourceExpression;
    let targetObserver = this.targetObserver as IBindingTargetObserver | undefined;
    if (!targetObserver) {
      targetObserver = this.targetObserver = this.observerLocator.getAccessor(flags, this.target, this.targetProperty) as IBindingTargetObserver;
    }
    if (targetObserver.bind) {
      targetObserver.bind(flags);
    }

    this.onChange(-1, flags);
    // const observers = getObservers(sourceExpression, this, scope);
    // const subscribers = observers.map((observer, idx) => new OptimizedSubscriber(
    //   this,
    //   observer,
    //   idx,
    //   idx === observers.length - 1
    // ));
    // const value = observers[observers.length - 1].getValue();
    // targetObserver.setValue(value, flags | this.persistentFlags);
    // this.observers = observers;
    // this.subscribers = subscribers;
    // sourceExpression.connect(flags, scope, this, part);

    // add isBound flag and remove isBinding flag
    this.$state |= State.isBound;
    this.$state &= ~State.isBinding;
  }

  public $unbind(flags: LifecycleFlags): void {
    if (!(this.$state & State.isBound)) {
      return;
    }
    // add isUnbinding flag
    this.$state |= State.isUnbinding;

    // clear persistent flags
    this.persistentFlags = LifecycleFlags.none;
    this.$scope = void 0;

    const targetObserver = this.targetObserver as IBindingTargetObserver;
    if (targetObserver.unbind) {
      targetObserver.unbind(flags);
    }
    if (targetObserver.unsubscribe) {
      targetObserver.unsubscribe(this);
      targetObserver[this.id] &= ~LifecycleFlags.updateSourceExpression;
    }
    this.subscribers.forEach(sub => sub.dispose());
    this.observers = PLATFORM.emptyArray;
    // this.unobserve(true);

    // remove isBound and isUnbinding flags
    this.$state &= ~(State.isBound | State.isUnbinding);
  }

  /**
   * @internal
   */
  public onChange(index: number, flags: LifecycleFlags) {
    const subscribers: OptimizedSubscriber[] = this.subscribers;
    let observers: PropertyObserver[] = this.observers || PLATFORM.emptyArray;
    for (let i = index + 1, ii = observers.length; ii > i; ++i) {
      subscribers[i].dispose();
    }
    observers = this.observers = getObservers(this.sourceExpression, this, this.$scope!);
    subscribers.length = observers.length;

    for (let i = index + 1, ii = observers.length; ii > i; ++i) {
      subscribers[i] = new OptimizedSubscriber(this, observers[i], i, i === ii - 1);
    }
    this.targetObserver?.setValue(
      observers[observers.length - 1].getValue(),
      flags | this.persistentFlags,
    );
  }
}

class OptimizedSubscriber {
  public constructor(
    public readonly owner: OptimizedPropertyBinding,
    public readonly observer: PropertyObserver,
    public readonly index: number,
    public readonly leaf: boolean,
  ) {
    observer.subscribe(this);
  }

  public handleChange(newValue: unknown, oldValue: unknown, flags: LifecycleFlags) {
    const binding = this.owner;
    if (this.leaf) {
      binding.targetObserver!.setValue(newValue, flags | this.owner.persistentFlags);
    } else {
      binding.onChange(this.index, flags);
    }
  }

  public dispose() {
    this.observer.unsubscribe(this);
  }
}

function getObservers(
  expression: IExpression,
  binding: OptimizedPropertyBinding,
  scope: IScope,
): PropertyObserver[] {
  let current = expression;
  let expressions = [];
  let contextObj: object | null | undefined = null;
  while (current != null) {
    switch (current.$kind) {
      case ExpressionKind.AccessScope:
        expressions[expressions.length] = current;
        contextObj = BindingContext.get(
          scope,
          (current as IAccessScopeExpression).name,
          (current as IAccessScopeExpression).ancestor,
          LifecycleFlags.none
        );
        break;
      case ExpressionKind.AccessMember:
        expressions[expressions.length] = current;
        current = (current as IAccessMemberExpression).object;
        break;
      default:
        throw new Error('Invalid expression leaked into optimized mode');
    }
  }

  if (contextObj != null) {
    return buildObservers(expressions.reverse(), contextObj, binding);
  }

  return PLATFORM.emptyArray;
}

function buildObservers(
  expressions: IExpression[],
  obj: object,
  binding: OptimizedPropertyBinding,
): PropertyObserver[] {
  const observers: PropertyObserver[] = [];
  const observerLocator = binding.observerLocator;
  let currentObj: any = obj;
  for (let i = 0, ii = expressions.length; ii > i; ++i) {
    const expr = expressions[i];
    switch (expr.$kind) {
      case ExpressionKind.AccessScope: {
        const observer = observers[i] = observerLocator.getObserver(
          LifecycleFlags.none,
          obj,
          (expr as IAccessScopeExpression).name
        ) as PropertyObserver;
        currentObj = observer.getValue();
        break;
      }
      case ExpressionKind.AccessMember: {
        const propName = (expr as IAccessMemberExpression).name;
        const observer = observers[i] = observerLocator.getObserver(
          LifecycleFlags.none,
          currentObj,
          propName
        ) as PropertyObserver;
        currentObj = observer.getValue();
        break;
      }
    }
    if (!(currentObj instanceof Object)) {
      break;
    }
  }

  return observers;
}
