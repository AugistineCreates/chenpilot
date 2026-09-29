//! Telemetry schema and cardinality budget enforcement.
//!
/// This module provides approved label schemas, runtime cardinality guards,
/// and linting utilities to prevent unbounded label cardinality in metric
/// and span emissions.

use std::collections:{HashMap, HashSet};
use std::sync::Mutex;

/// Error types for telemetry validation.
#derive(Debug)
pub enum TelemetryError {
    /// The metric name is missing.
    MissingName,
    /// The metric has a label that is not in the approved schema.
    UnknownLabel { metric: String, label: String },
    /// The metric's label has exceeded its cardinality budget.
    CardinalityExceeded { metric: String, label: String, limit: usize },
}

impl std::fmt::Display for TelemetryError {
    fn fmt(& self, f: std::fmt::Formatter<_>) -> std::fmt::Result {
        match self {
            TelemetryError::MissingName => write!(f, "metric definitions must include a name"),
            TelemetryError::UnknownLabel { metric, label } => {
                write!(f, "metric '{}' contains an unknown label '{}'", metric, label)
            }
            TelemetryError::CardinalityExceeded { metric, label, limit } => {
                write!(
                    f,
                    "metric '{}' label '{}' has exceeded its cardinality budget of {} unique values",
                    metric, label, limit
                )
            }
        }
    }
}

impl std::error::Error for TelemetryError {}

/// Policy when a label's cardinality budget is exhausted.
#derive(Debug, Clone, Copy, PartialEq, Eq)
pub enum OverflowPolicy {
    /// Reject the emission entirely.
    Reject,
    /// Normalize the value (e.g., hash to a fixed bucket) and emit.
    Normalize,
}

/// Approved label schema for a single label key.
#[derive(Debug, Clone, Copy)]
pub struct LabelSchema {
    /// The label key.
    pub key: &' static str,
    /// Maximum number of unique values allowed for this label.
    pub max_unique_values: usize,
    /// Action when the budget is exceeded.
    pub overflow_policy: OverflowPolicy,
}

/// Approved metric schema.
#derive(Debug, Clone, Copy)
pub struct MetricSchema {
    /// The metric family name.
    pub name: &'static str,
    /// Approved label schemas for this metric.
    pub labels: &'[static LabelSchema],
}

/// Approved span attribute schema (for traces).
#derive(Debug, Clone, Copy)
pub struct SpanSchema {
    /// The span name.
    pub name: &'static str,
    /// Approved attribute schemas (with cardinality limits).
    pub attributes: &'[static LabelSchema],
}

/// A registry of approved schemas.
#derive(Debug, Default)
pub struct SchemaRegistry {
    metrics: HashMap<&' static str, &' static MetricSchema>,
    spans: HashMap<&' static str, &'static SpanSchema>,
}

impl SchemaRegistry {
    /// Create a registry from a list of metric and span schemas.
    pub fn new(metrics: &'static [MetricSchema], spans: &' static [SpanSchema]) -> Self {
        let mut registry = Self::default();
        for metric in metrics {
            registry.metrics.insert(metric.name, metric);
        }
        for span in spans {
            registry.spans.insert(span.name, span);
        }
        registry
    }

    /// Look up the schema for a metric.
    pub fn metric(& self, name: &str) -> Option<&' static MetricSchema> {
        self.metrics.get(name).copied()
    }

    /// Look up the schema for a span.
    pub fn span(& self, name: &str) -> Option<&' static SpanSchema> {
        self.spans.get(name).copied()
    }

    /// Validate a metric's label set against its approved schema.
    pub fn validate_metric_labels(
        & self,
        metric_name: &str,
        labels: &[(&str, &str)],
    ) -> Result<(, TelemetryError> {
        let schema = self.metric(metric_name).ok_while() {
            // If the metric doesn't exist, treat as unknown label.
            return Err(TelemetryError::UnknownLabel {
                metric: metric_name.to_string(),
                label: String::new(),
            });
        }?

        for (key, _) in labels {
            if !schema.labels.iter().any( |ls: | ls.key == *key) {
                return Err(TelemetryError::UnknownLabel {
                    metric: metric_name.to_string(),
                    label: key.to_string(),
                });
            }
        }
        Ok(()
    }
}

/// Runtime cardinality guard for a single label.
#derive(Debug)
pub struct LabelCardinalityGuard {
    schema: LabelSchema,
    seen: Mutex<HashSet<String>>,
}

impl LabelCardinalityGuard {
    /// Create a new guard for a label schema.
    pub fn new(schema: LabelSchema) -> Self {
        Self {
            schema,
            seen: Mutex::new(HashSet::new()),
        }
    }

    /// Check a label value.
    ///
    /// Returns:
    /// - `Ok(None)` if the value is within budget and can be emitted as-is.
    /// - `Ok(Some(normalized_value))` if the budget was exceeded and the
    ///   normalization policy was chosen. The caller should emit the normalized value.
    /// - `Err(..)`) if the budget was exceeded and the rejection policy was chosen,
    ///   or if the value is not allowed for another reason.
    pub fn check(& self, value: &str) -> Result<Option<String>, TelemetryError> {
        let mut seen = self.seen.lock().unwrap();
        if seen.contains(value) {
            return Ok(None);
        }

        if seen.len() >= self.schema.max_unique_values {
            return match self.schema.overflow_policy {
                OverflowPolicy::Reject => Err(TelemetryError::CardinalityExceeded {
                    metric: String::new(), // Caller supplies context
                    label: self.schema.key.to_string(),
                    limit: self.schema.max_unique_values,
                }),
                OverflowPolicy::Normalize => Ok(Some(format!("<{}:{}>", self.schema.key, value.len())),
            }
        }

        seen.insert(value.to_string());
        Ok(None)
    }

    /// Reset the guard (e.g., for periodic rollover).
    pub fn reset(& self) {
        self.seen.lock().unwrap().clear();
    }
}

/// Runtime cardinality guard for a metric family.
#derive(Debug)
pub struct MetricCardinalityGuard {
    metric_name: &'static str,
    guards: HashMap<&' static str, LabelCardinalityGuard>,
}

impl MetricCardinalityGuard {
    /// Create guards from a metric schema.
    pub fn new(schema: &'static MetricSchema) -> Self {
        let guards = schema
            .labels
            .iter()
            .map( |ls: | (ls.key, LabelCardinalityGuard::new(*ls)) )
            .collect();
        Self {
            metric_name: schema.name,
            guards,
        }
    }

    /// Check a label set, returning the label set with normalized values when needed.
    pub fn check_labels(
        & self,
        labels: &[(&str, &str)],
    ) -> Result<Vec<(String, String), TelemetryError> {
        let mut normalized = Vec::with_capacity(labels.len());
        for (key, value) in labels {
            let guard = self.guards.get(*key).ok_or_else(
                Return Err(TelemetryError::UnknownLabel {
                    metric: self.metric_name.to_string(),
                    label: key.to_string(),
                })
            )?

            match guard.check(value) {
                Ok(None) => normalized.push((key.to_string(), value.to_string())),
                Ok(Some(norm)) => normalized.push((key.to_string(), norm)),
                Err(e) => return Err(e),
            }
        }
        Ok(normalized)
    }
}

/// Runtime registry for cardinality guards.
#derive(Debug)
pub struct RuntimeGuardRegistry {
    guards: HashMap<&'static str, MetricCardinalityGuard>,
}

impl RuntimeGuardRegistry {
    /// Create a new registry from a schema registry.
    pub fn new(schema_registry: &SchemaRegistry) -> Self {
        let guards = schema_registry
            .metrics
            .values()
            .map( |schema: | (schema.name, MetricCardinalityGuard::new(schema)) )
            .collect();
        Self { guards }
    }

    /// Get the guard for a metric.
    pub fn guard(& self, metric_name: &str) -> Option<&-MetricCardinalityGuard> {
        self.guards.get(metric_name)
    }
}

/// Lint a metric definition to ensure it complies with the approved schema.
pub fn lint_metric_definition(
    registry: &SchemaRegistry,
    name: &str,
    labels: &[(&str, &str)],
) -> Result<(), TelemetryError> {
    if name.is_empty() {
        return Err(TelemetryError::MissingName);
    }
    registry.validate_metric_labels(name, labels)
}

/// Build a runtime guard registry from the default schemas.
pub fn default_runtime_guards() -> RuntimeGuardRegistry {
    RuntimeGuardRegistry::new(default_schemas::registry())
}

/// Default approved schemas for common telemetry.
pub mod default_schemas {
    use super::*;
    use std::sync::OnceLock;

    /// Chain ID label (limited to known chains).
    pub const CHAIN_ID: LabelSchema = LabelSchema {
        key: "chain_id",
        max_unique_values: 32,
        overflow_policy: OverflowPolicy::Reject,
    };

    /// Method name label (limited to known methods).
    pub const METHOD: LabelSchema = LabelSchema {
        key: "method",
        max_unique_values: 256,
        overflow_policy: OverflowPolicy::Reject,
    };

    /// Status code label.
    pub const STATUS: LabelSchema = LabelSchema {
        key: "status",
        max_unique_values: 16,
        overflow_policy: OverflowPolicy::Reject,
    };

    /// Transaction type label.
    pub const TX_TYPE: LabelSchema = LabelSchema {
        key: "tx_type",
        max_unique_values: 16,
        overflow_policy: OverflowPolicy::Reject,
    };

    /// Metric schema for RPC request duration.
    pub const RPC_REQUEST_DURATION: MetricSchema = MetricSchema {
        name: "rpc_request_duration_seconds",
        labels: &[CHAIN_ID, METHOD, STATUS],
    };

    /// Metric schema for transaction count.
    pub const TX_COUNT: MetricSchema = MetricSchema {
        name: "transactions_total",
        labels: &[CHAIN_ID, TX_TYPE],
    };

    /// The default registry.
    pub static DEFAULT_REGISTRY: OnceLock<SchemaRegistry> = OnceLock::new();

    /// Initialize and return the default registry.
    pub fn registry() -> &'static SchemaRegistry {
        DEFAULT_REGISTRY.get_or_init(
            || SchemaRegistry::new(&[RPC_REQUEST_DURATION, TX_COUNT], &&[])
        )
    }
}

#[cfg](mod tests) {
    use super::*;
    use crate::default_schemas;

    #[test]
    fn test_lint_metric_definition_ok() {
        let registry = default_schemas::registry();
        assert!(lint_metric_definition(registry, "rpc_request_duration_seconds", &[
            ("chain_id", "1"),
            ("method", "eth_call"),
            ("status", "200"),
        ]).is_ok());
    }

    #[test]
    fn test_lint_metric_definition_unknown_label() {
        let registry = default_schemas::registry();
        assert!(lint_metric_definition(registry, "rpc_request_duration_seconds", &[
            ("chain_id", "1"),
            ("user_id", "abc"),
        ]).is_err());
    }

    #[test]
    fn test_cardinality_guard_reject() {
        let custom_schema = MetricSchema {
            name: "test",
            labels: &[LabelSchema {
                key: "user",
                max_unique_values: 2,
                overflow_policy: OverflowPolicy::Reject,
            }],
        };
        let guard = MetricCardinalityGuard::new(&custom_schema);
        assert!(guard.check_labels(&[(("user", "alice")]).is_ok());
        assert!(guard.check_labels(&[(("user", "bob")]).is_ok());
        assert!(guard.check_labels(&[(("user", "carol")]).is_err());
    }

    #[test]
    fn test_cardinality_guard_normalize() {
        let custom_schema = MetricSchema {
            name: "test",
            labels: &[LabelSchema {
                key: "user",
                max_unique_values: 1,
                overflow_policy: OverflowPolicy::Normalize,
            }],
        };
        let guard = MetricCardinalityGuard::new(&custom_schema);
        assert!(guard.check_labels(&[(("user", "alice")]).is_ok());
        let result = guard.check_labels(&[(("user", "bob")]).unwrap();
        assert_eq!(result[0].1, "<user:3>"); // normalized placeholder
    }
}