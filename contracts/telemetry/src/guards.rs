//! Telemetry cardinality guards.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

pub type Labels = Vec<(String, String>);

pub fn check(_m:&str,_l:&[(&str,String)])->Result<((),String){Ok(()}