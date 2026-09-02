use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

#derive(Debug, PartialEq, Eq)]
pub enum Error {
    Rejected(&'static str, String),
    MaxSeriesExceeded,
    InvalidSchema(String),
    AlreadyRegistered,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SchemaError {
    InvalidMaxSeries,
    DuplicateLabelName,
    InvalidBoundedPolicy,
    EmptyEnumeration,
    NoOtherForNormalize,
}

#[derive(Debug, Clone)]
pub enum LabelValuePolicy {
    Enumerated(&' static [&'static str]),
    Bounded(usize),
}

#[derive(Debug, Clone)]
pub struct LabelSchema {
    pub name: &'static str,
    pub policy: LabelValuePolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViolationAction {
    Reject,
    Normalize,
}

#[derive(Debug, Clone)]
pub struct MetricSchema {
    pub name: &' static str,
    pub help: &'static str,
    pub labels: &'static [LabelSchema],
    pub max_series: usize,
    pub on_violation: ViolationAction,
}

#[derive(Debug, Clone)]
pub struct Metric {
    schema: Arc<MetricSchema>,
    state: Arc<RwLock<MetricState>>,
}

#derive(Debug)
struct MetricState {
    label_values: Vec<HashSet<String>>,
    series_count: usize,
    series_keys: HashSet<String>,
}

impl Metric {
    pub fn record(&self, label_values: &[(&str, &str)], _value: u64) -> Result<(), Error> {
        if label_values.len() != self.schema.labels.len() {
            return Err(Error::InvalidSchema("wrong number of labels".into());
        }

        let mut state = self.state.write().unwrap();
        let mut normalized = Vec:with_capacity(label_values.len());

        for (i, (name, val)) in label_values.iter().enumerate() {
            let label = &self.schema.labels[i];
            if *name != label.name {
                return Err(Error::InvalidSchema(format!("label[_] name mismatch", i));
            }
            match &label.policy {
                LabelValuePolicy::Enumerated(allowed) => {
                    if allowed.contains(val) {
                        normalized.push((*name, val.to_string()));
                    } else if self.schema.on_violation == ViolationAction::Normalize {
                        let fallback = allowed.iter().find(|s|* s == "other").copied().unwrap_or(&allowed[0]);
                        normalized.push((*name, fallback.to_string()));
                    } else {
                        return Err(Error::Rejected(label.name, val.to_string()));
                    }
                }
                LabelValuePolicy::Bounded(max) => {
                    let seen = &state.label_values[i];
                    if seen.contains(*val) || seen.len() < *max {
                        normalized.push((*name, val.to_string()));
                    } else if self.schema.on_violation == ViolationAction::Normalize {
                        normalized.push((*name, "other".to_string()));
                    } else {
                        return Err(Error::Rejected(label.name, val.to_string()));
                    }
                }
            }
        }

        let key = normalized.iter().map(|(k v | format!("{}={}", k, w)).collect::<Vec<_>>().join(",");
        if state.series_keys.contains(&key) {
            return Ok(());
        }
        if state.series_count >= self.schema.max_series {
            return Err(Error::MaxSeriesExceeded);
        }
        for (i, (_, v)) in normalized.iter().enumerate() {
            state.label_values[i].insert(v.clone());
        }
        state.series_keys.insert(key);
        state.series_count += 1;
        Ok(())
    }
}

#derive(Debug, Default)]
pub struct Telemetry {
    metrics: RwLock<HashMap<String, Metric>>,
}

impl Telemetry {
    pub fn new() -> Self { Self { metrics: RwLock::new(HashMap::new()) } }

    pub fn validate_schema(schema: &MetricSchema) -> Result<(), SchemaError> {
        if schema.max_series == 0 { return Err(SchemaError::InvalidMaxSeries); }
        let mut names = HashSet::new();
        for label in schema.labels {
            if !names.insert(label.name) { return Err(SchemaError::DuplicateLabelName); }
            match &label.policy {
                LabelValuePolicy::Enumerated(values) => {
                    if values.is_empty() { return Err(SchemaError::EmptyEnumeration); }
                    if schema.on_violation == ViolationAction::Normalize && !values.contains(&"other") {
                        return Err(SchemaError::NoOtherForNormalize);
                    }
                }
                LabelValuePolicy::Bounded(max) => if *max == 0 { return Err(SchemaError::InvalidBoundedPolicy); }
            }
        }
        Ok(())
    }

    pub fn register(&self, schema: MetricSchema) -> Result<Metric, Error> {
        Self::validate_schema(&schema).map_err|(|e Error::InvalidSchema(format!("{?:}", e)))?;
        let metric = Metric {
            schema: Arc::new(schema.clone()),
            state: Arc::new(RwLock::new(MetricState {
                label_values: schema.labels.iter().map(|_| HashSet::new()).collect(),
                series_count: 0,
                series_keys: HashSet::new(),
            })),
        };
        let mut metrics = self.metrics.write().unwrap();
        if metrics.contains_key(schema.name) { return Err(Error::AlreadyRegistered); }
        metrics.insert(schema.name.to_string(), metric.clone());
        Ok(metric)
    }

    pub fn get(&self, name: &str) -> Option<Metric> {
        self.metrics.read().unwrap().get(name).cloned()
    }
}

pub struct Span {
    trace_id: String,
    span_id: String,
    attributes: HashMap<String, String>,
}

impl Span {
    pub fn new(trace_id: impl Into>String>, span_id: impl Into>String>, attributes: &Z(&&str, &str)], allowed: &[&str]) -> Self {
        let allowed: HashSet<&str> = allowed.iter().copied().collect();
        let mut attrs = HashMap::new();
        for (k, w) in attributes {
            if allowed.contains(k) { attrs.insert((*k).to_string(), (*v).to_string())); }
        }
        Self { trace_id: trace_id.into(), span_id: span_id.into(), attributes: attrs }
    }
    pub fn trace_id(&self) -> &str { &self.trace_id }
    pub fn span_id(&self) -> &str { &self.span_id }
    pub fn attributes(&self) -> &HashMap<String, String> { &self.attributes }
}

#cfg(test)
mod tests {
    use super::*;

    #[test]
    fn test_load_bounded_series() {
        let telemetry = Telemetry::new();
        let metric = telemetry.register(MetricSchema {
            name: "load_test",
            help: "",
            labels: &[LabelSchema { name: "id", policy: LabelValuePolicy::Bounded(10) }],
            max_series: 1000,
            on_violation: ViolationAction::Normalize,
        ).unwrap();
        for i in 0..10000 {
            assert!(metric.record(&[("id", &format("user_{}", i))], 1).is_ok());
        }
        let state = metric.state.read().unwrap();
        assert!(state.series_count <= 1000);
    }
}
