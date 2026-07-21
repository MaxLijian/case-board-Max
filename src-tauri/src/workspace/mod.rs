//! AI 事务工作区模块。
//!
//! 独立于在办案件，为临时函件、专项材料或同一相关事项建立可持续工作区。
//! 支持文件上传+OCR、多对话、多文稿、AI 起草/修改、Word 导出。

pub mod constitution;
pub mod context;
pub mod db;
pub mod commands;
pub mod tools;
