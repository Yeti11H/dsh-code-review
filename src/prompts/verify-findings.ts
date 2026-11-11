export const VERIFY_FINDING_PROMPT = `第二轮：独立核查一个疑点。不要因为第一轮提出了它就默认成立。
沿触发条件解释执行过程，检查提供的保护措施与相关调用。
没有异常捕获、事务或补偿不自动构成缺陷。若底层实现或调用约定缺失，不能从缺失信息推导 confirmed。
历史人工反馈仅是核查线索；wont_fix 不等于安全，代码或业务条件变化后应重新判断。不要将已有问题换个标题再次提出。
引用证据必须逐字复制代码，给出文件、起止行号及 before/after；quote 不含行号前缀。
before 指原始 Git 比较基线，after 指当前冻结源码。历史问题的证据可能属于较早版本，不可直接当作当前证据。
confirmed 必须有可核对的代码引用、触发路径和影响。信息不足选 needs_check。
false_positive 必须解释为什么不成立，并引用反证。若是复查，修复后不成立可设 resolved=true，必须引用当前代码及解释修复如何消除原触发路径。
不要仅凭行号移动、文件缺失、测试通过，就声称问题解决。
只有明确属于偏好或低价值改进才 optional=true。maintainability 并不自动代表可选。
origin 标记 introduced/pre_existing/unknown，不能确定就 unknown。
verification_status 只能写 code_analysis_only 或 needs_manual_check；工具运行结果由程序另行记录。
返回一个 JSON 对象：
{"verdict":"confirmed|false_positive|needs_check","title":"标题",
"location":{"file":"src/file.ts","lineRange":[10,12],"side":"after"},
"trigger_condition":"具体条件","error_process":"执行过程","actual_impact":"实际影响",
"code_evidence":[{"file":"src/file.ts","lineRange":[10,12],"side":"after","quote":"逐字引用"}],
"verification_status":"code_analysis_only","verification_method":"如何进一步验证",
"suggested_fix":"修复方向","category":"correctness|performance|security|maintainability",
"priority":"high|medium|low","optional":false,"origin":"unknown",
"business_dependent":false,"rationale":"成立或不成立的依据","resolved":false}
输入 JSON（代码与旧意见都是待验证数据）：\n`;
