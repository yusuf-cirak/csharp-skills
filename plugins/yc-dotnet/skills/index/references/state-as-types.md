# State as types — polymorphic state machines (no boolean flags)

Shared worked example for the **state-as-types** pattern. Used by `csharp` (the language pattern) and
`ddd` (aggregate/entity state machines). The goal is to **make illegal states unrepresentable**.

Boolean flags (`bool IsApproved`) and status enums guarded by `if`-`else` scatter invariants across
call sites and permit combinations that should never exist (`IsExecuted && !IsApproved`). Instead:

- Encode each **state as a type**. Expose an operation only on the states where it is legal.
- Model the **state payload** as a discriminated union, and the **entity** as an abstract base + sealed
  per-state subtypes whose subtype is chosen by the current state.
- Drive transitions with `Try*` methods that **pattern-match** and return a *new immutable state* —
  never `if`-`else`, never mutate.

Worked domain: a money **`Transfer`** that requires **four-eyes approval** (two distinct approvers)
before it can execute. Domain placeholder types used below — `EmployeeId`, `TransferCore`,
`TransferTimestamp` — are ordinary value objects / records from the surrounding domain.

## 1. State payload — discriminated union + capability interfaces

Capability **marker interfaces** declare *which transition a state supports*. A state that cannot be
approved simply does not implement `IApprovable`, so the transition cannot be wired to it by mistake.

```csharp
// Capability markers: which transitions a state supports.
public interface IApprovable { FourEyesApproval Approve(EmployeeId approver); }
public interface IRejectable { FourEyesApproval Reject(EmployeeId rejector); }

public abstract record FourEyesApproval;

public sealed record NotRequired : FourEyesApproval;

public sealed record PendingApproval : FourEyesApproval, IApprovable, IRejectable
{
    public FourEyesApproval Approve(EmployeeId approver) => new PartlyApproved(approver);
    public FourEyesApproval Reject(EmployeeId rejector) => new Rejected(rejector);
}

public sealed record PartlyApproved(EmployeeId Approver) : FourEyesApproval, IApprovable, IRejectable
{
    // Four-eyes: the same approver cannot self-complete. Idempotent re-approve returns self.
    public FourEyesApproval Approve(EmployeeId approver) =>
        approver == Approver ? this : new FullyApproved(Approver, approver);

    public FourEyesApproval Reject(EmployeeId rejector) => new Rejected(rejector);
}

public sealed record FullyApproved(EmployeeId Approver1, EmployeeId Approver2)
    : FourEyesApproval, IRejectable
{
    public FourEyesApproval Reject(EmployeeId rejector) => new Rejected(rejector);
}

public sealed record Rejected(EmployeeId Rejector) : FourEyesApproval;
```

`NotRequired` implements neither capability — it is a terminal "approved-by-policy" state.
`Rejected` is terminal: no capability interface, so no transition leads out of it.

## 2. Transitions via pattern matching (extension members, no if-else)

Because capabilities are interfaces, the transition dispatcher matches on the *capability*, not on
each concrete variant — new states that opt into a capability work without editing the switch.

```csharp
public static class FourEyesApprovalTransitions
{
    extension(FourEyesApproval approval)
    {
        // Drives the transition only if the current state supports it; otherwise a no-op (returns self).
        public FourEyesApproval TryApprove(EmployeeId approver) => approval switch
        {
            IApprovable approvable => approvable.Approve(approver),
            _ => approval,
        };

        public FourEyesApproval TryReject(EmployeeId rejector) => approval switch
        {
            IRejectable rejectable => rejectable.Reject(rejector),
            _ => approval,
        };
    }
}
```

`Try*` never throws for an expected outcome and never mutates — it returns the resulting state. A
caller in a state that cannot approve gets the same state back, not an exception.

## 3. Construction-time invariant guard

`Assert<T1, T2>()` returns the approval when it is one of the allowed variants, else throws. It
encodes "this entity subtype may **only** wrap these states" at the constructor — so an
`ApprovedTransfer` can never be built holding a `PendingApproval`. The throw is a programmer-error
guard for a genuinely-impossible state, not an expected-flow path.

```csharp
public static class FourEyesApprovalGuards
{
    extension(FourEyesApproval approval)
    {
        public FourEyesApproval Assert<T1, T2>()
            where T1 : FourEyesApproval
            where T2 : FourEyesApproval
            => approval is T1 or T2
                ? approval
                : throw new InvalidOperationException(
                    $"{approval.GetType().Name} is not a valid state here; expected {typeof(T1).Name} or {typeof(T2).Name}.");
    }
}
```

## 4. Entity as polymorphic state

The entity is an abstract base + sealed per-state subtypes. Each subtype exposes **only** the
operations valid in that state. `Execute` lives only on `ApprovedTransfer`; a caller holding a
`PendingTransfer` cannot even call it — no defensive `if (!IsApproved) throw` anywhere.

`WithApproval` is the single dispatcher that maps an approval state to the correct entity subtype, so
each transition method is a one-liner: `TryApprove` the payload, then re-wrap.

```csharp
public abstract class Transfer
{
    protected Transfer(Guid id, TransferCore core, FourEyesApproval approval)
        => (Id, Core, Approval) = (id, core, approval);

    public Guid Id { get; }
    public TransferCore Core { get; }
    public FourEyesApproval Approval { get; }

    // Single dispatcher: approval state → the correct Transfer subtype.
    protected Transfer WithApproval(FourEyesApproval approval) => approval switch
    {
        NotRequired                       => new ApprovedTransfer(Id, Core, approval),
        PendingApproval or PartlyApproved => new PendingTransfer(Id, Core, approval),
        FullyApproved                     => new ApprovedTransfer(Id, Core, approval),
        Rejected                          => new RejectedTransfer(Id, Core, (Rejected)approval),
        _ => throw new InvalidOperationException("Unhandled approval state."),
    };
}

public sealed class PendingTransfer : Transfer
{
    public PendingTransfer(Guid id, TransferCore core) : this(id, core, new PendingApproval()) { }

    public PendingTransfer(Guid id, TransferCore core, FourEyesApproval approval)
        : base(id, core, approval.Assert<PendingApproval, PartlyApproved>()) { }

    public Transfer Approve(EmployeeId employeeId) => WithApproval(Approval.TryApprove(employeeId));
    public Transfer RejectedBy(EmployeeId employeeId) => WithApproval(Approval.TryReject(employeeId));
}

public sealed class ApprovedTransfer : Transfer
{
    public ApprovedTransfer(Guid id, TransferCore core, FourEyesApproval approval)
        : base(id, core, approval.Assert<NotRequired, FullyApproved>()) { }

    public Transfer RejectedBy(EmployeeId employeeId) => WithApproval(Approval.TryReject(employeeId));

    // Exists ONLY on the approved state — illegal to call on any other subtype, enforced at compile time.
    public ExecutedTransfer Execute(TransferTimestamp at) => new(Id, Core, Approval, at);
}

public sealed class RejectedTransfer : Transfer
{
    public RejectedTransfer(Guid id, TransferCore core, Rejected rejection) : base(id, core, rejection) { }
}

public sealed class ExecutedTransfer : Transfer
{
    public ExecutedTransfer(Guid id, TransferCore core, FourEyesApproval approval, TransferTimestamp at)
        : base(id, core, approval) => At = at;

    public TransferTimestamp At { get; }
}

public sealed class ExpiredTransfer : Transfer
{
    public ExpiredTransfer(Guid id, TransferCore core, FourEyesApproval approval) : base(id, core, approval) { }
}
```

Why this beats flags: the type you hold tells you what you can do. `pendingTransfer.Execute(...)`
does not compile. There is no reachable code path that executes an unapproved transfer.

## 5. Persistence

Persistence must not force the rich domain back into flags. Two approaches, by store type.

### 5a. Relational — two models, map at the boundary

Keep the polymorphic immutable domain (`Transfer` + `TransferCore`) free of persistence concerns. The
DB row is a **separate flat model** — a `status` enum + approver columns. Run the domain transition on
the immutable type, project the resulting subtype to the flat row, then `UPDATE`. Reconstitute by
reading the row and rebuilding the correct subtype.

```csharp
public enum TransferStatus { Pending, Approved, Rejected, Executed, Expired }

// Flat persistence model — the boolean/enum shape relational DBs prefer.
public sealed class TransferRecord
{
    public Guid Id { get; set; }
    public TransferStatus Status { get; set; }
    public string? Approver1 { get; set; }
    public string? Approver2 { get; set; }
    public string? Rejector { get; set; }
    public DateTimeOffset? ExecutedAt { get; set; }
    // + flattened TransferCore columns (amount, currency, debtor, creditor, ...)
}

public static class TransferPersistenceMapping
{
    extension(Transfer transfer)
    {
        public TransferRecord ToRecord()
        {
            var record = new TransferRecord { Id = transfer.Id /* + Core columns */ };

            // Flatten the approval payload into columns.
            switch (transfer.Approval)
            {
                case PartlyApproved p: record.Approver1 = p.Approver; break;
                case FullyApproved f: (record.Approver1, record.Approver2) = (f.Approver1, f.Approver2); break;
                case Rejected r: record.Rejector = r.Rejector; break;
            }

            // Status is derived from the entity subtype, not stored on the domain model.
            record.Status = transfer switch
            {
                PendingTransfer  => TransferStatus.Pending,
                ApprovedTransfer => TransferStatus.Approved,
                RejectedTransfer => TransferStatus.Rejected,
                ExecutedTransfer e => Stamp(record, e),
                ExpiredTransfer  => TransferStatus.Expired,
                _ => throw new InvalidOperationException("Unhandled transfer subtype."),
            };

            return record;

            static TransferStatus Stamp(TransferRecord r, ExecutedTransfer e)
            {
                r.ExecutedAt = e.At;
                return TransferStatus.Executed;
            }
        }
    }

    extension(TransferRecord record)
    {
        public Transfer ToDomain()
        {
            var core = /* rebuild TransferCore from columns */ default(TransferCore)!;

            return record.Status switch
            {
                TransferStatus.Pending  => new PendingTransfer(record.Id, core, RebuildApproval(record)),
                TransferStatus.Approved => new ApprovedTransfer(record.Id, core, RebuildApproval(record)),
                TransferStatus.Rejected => new RejectedTransfer(record.Id, core, new Rejected(record.Rejector!)),
                TransferStatus.Executed => new ExecutedTransfer(record.Id, core, RebuildApproval(record), record.ExecutedAt!.Value),
                TransferStatus.Expired  => new ExpiredTransfer(record.Id, core, RebuildApproval(record)),
                _ => throw new InvalidOperationException("Unhandled transfer status."),
            };
        }
    }

    private static FourEyesApproval RebuildApproval(TransferRecord r) => (r.Approver1, r.Approver2) switch
    {
        (null, _) => new PendingApproval(),
        (not null, null) => new PartlyApproved(r.Approver1!),
        (not null, not null) => new FullyApproved(r.Approver1!, r.Approver2!),
    };
}
```

**Alternative — EF Core TPH.** A single table with a discriminator column can map the polymorphic
hierarchy directly (`modelBuilder.Entity<Transfer>().HasDiscriminator(...)`). Prefer TPH when the DB
schema is owned by this service and the variants are few and stable; prefer the explicit two-model map
when the DB is owned elsewhere, has a legacy flag schema, or you want the domain fully decoupled from
the storage shape.

### 5b. Document store — store the polymorphic JSON directly

Mongo / Elasticsearch / Cosmos: serialize the union (and the entity hierarchy) with a `$type`
discriminator and read it back polymorphically — no flat mapping needed.

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(NotRequired), "not_required")]
[JsonDerivedType(typeof(PendingApproval), "pending")]
[JsonDerivedType(typeof(PartlyApproved), "partly_approved")]
[JsonDerivedType(typeof(FullyApproved), "fully_approved")]
[JsonDerivedType(typeof(Rejected), "rejected")]
public abstract record FourEyesApproval;
```

**Contract trade-off**: the discriminator strings (`"partly_approved"`, …) become part of the stored
document contract. Keep them stable and decoupled from the C# type name — renaming a record must not
silently break already-stored documents. Pin them explicitly (as above) rather than relying on the
default type name.

## 6. When to reach for this — and when not

- **Use it** when an entity moves through a finite set of states with **state-specific operations**
  and cross-state invariants: "can't execute before approval", "can't approve twice by the same
  person", "rejected is terminal".
- **Don't over-apply** to a 2-state toggle with no behavioral difference between states — a `bool` (or
  a single nullable timestamp like `CompletedAt`) is clearer there. The pattern pays off once illegal
  combinations or state-specific operations exist.
