"
I am a comparison table: for each task, a baseline run, the fork of it with a candidate variant and the candidate's full reruns (TdComparison rows), with the summary of a runner gate report (INTERFACES.md §5.4): agreement between forks and reruns, fork versus rerun tokens and cost, pass rates by split. My dictionary has the gate report's shape, and my summary is computed like the runner's gate (runner/src/gate.ts): one fork is compared with one rerun per task (a task's reruns are averaged), ratios are rounded to 4 decimals.

Built from a store, I take for each task the latest fork of a baseline run with the candidate, and as reruns the candidate's recorded runs of that task with the fork's model.

	TdComparisonTable forCandidate: 'rule-taskrunner' baseline: 'vanilla' in: store.
	TdComparisonTable fromGateReport: (store reportNamed: 'rule-taskrunner-vs-vanilla') in: store.
	TdComparisonTable forStore: store.	""one row per fork in the store""
	aTable agreement.
	aTable tokenSavings.
"
Class {
	#name : 'TdComparisonTable',
	#superclass : 'Object',
	#instVars : [
		'name',
		'candidate',
		'baseline',
		'model',
		'createdAt',
		'rows'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdComparisonTable class >> forCandidate: aCandidateName baseline: aBaselineName in: aStore [
	"One row per baseline run of aBaselineName that has a fork with aCandidateName (the latest fork)."

	| forks |
	forks := aStore forks select: [ :each |
		         each variant = aCandidateName and: [
			         each parent notNil and: [ each parent variant = aBaselineName ] ] ].
	^ self new
		  setCandidate: aCandidateName baseline: aBaselineName;
		  rows: (self rowsForForks: forks in: aStore);
		  yourself
]

{ #category : 'instance creation' }
TdComparisonTable class >> forStore: aStore [
	"One row per task and pair of variants (baseline, candidate) found among the forks of the store."

	^ self new
		  name: 'forks in the image';
		  rows: (self rowsForForks: (aStore forks select: [ :each | each parent notNil ]) in: aStore);
		  yourself
]

{ #category : 'instance creation' }
TdComparisonTable class >> fromGateReport: aReportDictionaryOrFile [

	^ self fromGateReport: aReportDictionaryOrFile in: nil
]

{ #category : 'instance creation' }
TdComparisonTable class >> fromGateReport: aReportDictionaryOrFile in: aStoreOrNil [
	"A runner gate report (tapedeck.gate/v1); with a store, its run ids are resolved to runs."

	| report |
	report := aReportDictionaryOrFile isDictionary
		          ifTrue: [ aReportDictionaryOrFile ]
		          ifFalse: [ TdJson fromFile: aReportDictionaryOrFile ].
	^ self new
		  name: (report at: 'name' ifAbsent: [ nil ]);
		  setCandidate: (report at: 'candidate' ifAbsent: [ nil ])
		  baseline: (report at: 'baseline' ifAbsent: [ nil ]);
		  model: (report at: 'model' ifAbsent: [ nil ]);
		  createdAt: (report at: 'createdAt' ifAbsent: [ nil ]);
		  rows: (((report at: 'rows' ifAbsent: [ nil ]) ifNil: [ #(  ) ]) collect: [ :each |
				   TdComparison fromRow: each store: aStoreOrNil ]);
		  yourself
]

{ #category : 'private' }
TdComparisonTable class >> rerunsFor: aFork in: aStore [
	"The candidate's recorded runs of the fork's task, with the fork's model when it is known."

	^ (aStore rerunsOf: aFork variant task: aFork task) select: [ :each |
		  aFork model isNil or: [ each model = aFork model ] ]
]

{ #category : 'private' }
TdComparisonTable class >> rowsForForks: aCollectionOfForks in: aStore [
	"One row per task and pair of variants, from the latest fork."

	| latest |
	latest := OrderedDictionary new.
	(aCollectionOfForks asArray sorted: [ :a :b | a id <= b id ]) do: [ :fork |
		latest at: { fork task. fork parent variant. fork variant } put: fork ].
	^ (latest values collect: [ :fork |
		   TdComparison baseline: fork parent fork: fork reruns: (self rerunsFor: fork in: aStore) ])
		  sorted: [ :a :b | a task asString <= b task asString ]
]

{ #category : 'converting' }
TdComparisonTable >> asDictionary [
	"The gate report shape (tapedeck.gate/v1)."

	^ OrderedDictionary new
		  at: 'format' put: 'tapedeck.gate/v1';
		  at: 'name' put: self name;
		  at: 'candidate' put: candidate;
		  at: 'baseline' put: baseline;
		  at: 'model' put: self model;
		  at: 'createdAt' put: createdAt;
		  at: 'rows' put: (rows collect: [ :each | each asDictionary ]) asArray;
		  at: 'summary' put: self summaryDictionary;
		  yourself
]

{ #category : 'summary' }
TdComparisonTable >> agreement [
	"The share of rows whose fork verdict agrees with the reruns (0 without rows)."

	rows isEmpty ifTrue: [ ^ 0 ].
	^ self ratio: (rows count: [ :each | each agree == true ]) of: rows size
]

{ #category : 'summary' }
TdComparisonTable >> baselinePassRate [
	"split -> pass rate of the baseline runs."

	^ self passRatesOf: [ :row | { row baselinePass } ]
]

{ #category : 'accessing' }
TdComparisonTable >> baseline [

	^ baseline
]

{ #category : 'accessing' }
TdComparisonTable >> candidate [

	^ candidate
]

{ #category : 'summary' }
TdComparisonTable >> candidateForkPassRate [
	"split -> pass rate of the forks."

	^ self passRatesOf: [ :row | { row forkPass } ]
]

{ #category : 'summary' }
TdComparisonTable >> candidateRerunPassRate [
	"split -> pass rate over all reruns."

	^ self passRatesOf: [ :row | row rerunPasses ]
]

{ #category : 'accessing' }
TdComparisonTable >> createdAt [

	^ createdAt
]

{ #category : 'accessing' }
TdComparisonTable >> createdAt: aString [

	createdAt := aString
]

{ #category : 'queries' }
TdComparisonTable >> disagreements [
	"The rows where the fork's verdict differs from the reruns'."

	^ rows select: [ :each | each agree == false ]
]

{ #category : 'summary' }
TdComparisonTable >> forkCost [

	^ self forkUsage roundedCost
]

{ #category : 'summary' }
TdComparisonTable >> forkTokens [

	^ self forkUsage totalTokens
]

{ #category : 'summary' }
TdComparisonTable >> forkUsage [

	^ TdUsage sumOf: (rows collect: [ :each | each forkUsage ])
]

{ #category : 'initialization' }
TdComparisonTable >> initialize [

	super initialize.
	rows := #(  ).
	createdAt := DateAndTime now asUTC printString
]

{ #category : 'accessing' }
TdComparisonTable >> model [

	^ model ifNil: [
		  rows
			  detect: [ :each | each forkRun notNil ]
			  ifFound: [ :each | each forkRun model ]
			  ifNone: [ nil ] ]
]

{ #category : 'accessing' }
TdComparisonTable >> model: aString [

	model := aString
]

{ #category : 'summary' }
TdComparisonTable >> n [

	^ rows size
]

{ #category : 'accessing' }
TdComparisonTable >> name [

	^ name ifNil: [
		  (candidate notNil and: [ baseline notNil ])
			  ifTrue: [ candidate , '-vs-' , baseline ]
			  ifFalse: [ nil ] ]
]

{ #category : 'accessing' }
TdComparisonTable >> name: aString [

	name := aString
]

{ #category : 'private' }
TdComparisonTable >> passRatesOf: aVerdictsBlock [
	"split -> share of true verdicts among the verdicts aVerdictsBlock answers for the rows of that split."

	| rates |
	rates := OrderedDictionary new.
	self splits do: [ :split |
		| verdicts |
		verdicts := ((self rowsForSplit: split) flatCollect: [ :row | aVerdictsBlock value: row ]) reject: [
			            :each | each isNil ].
		verdicts ifNotEmpty: [
			rates at: split put: (self ratio: (verdicts count: [ :each | each == true ]) of: verdicts size) ] ].
	^ rates
]

{ #category : 'printing' }
TdComparisonTable >> printOn: aStream [

	aStream
		nextPutAll: 'TdComparisonTable(';
		nextPutAll: self name asString;
		nextPutAll: ': ';
		print: self n;
		nextPutAll: ' rows, agreement ';
		print: self agreement;
		nextPutAll: ', token savings ';
		print: self tokenSavings;
		nextPut: $)
]

{ #category : 'private' }
TdComparisonTable >> ratio: aPart of: aWhole [
	"Rounded to 4 decimals; nil for an empty whole."

	aWhole = 0 ifTrue: [ ^ nil ].
	^ (aPart / aWhole * 10000) rounded / 10000.0
]

{ #category : 'summary' }
TdComparisonTable >> rerunCost [
	"Dollars of one rerun per task, summed over rows."

	^ TdUsage roundCost: (rows inject: 0 into: [ :sum :each | sum + each rerunCostPerRun ])
]

{ #category : 'summary' }
TdComparisonTable >> rerunTokens [
	"Tokens of one rerun per task, summed over rows: what full reruns would cost instead of the forks."

	^ (rows inject: 0 into: [ :sum :each | sum + each rerunTokensPerRun ]) rounded
]

{ #category : 'summary' }
TdComparisonTable >> rerunUsage [
	"What all the reruns spent."

	^ TdUsage sumOf: (rows collect: [ :each | each rerunUsage ])
]

{ #category : 'accessing' }
TdComparisonTable >> rows [
	"TdComparison rows."

	^ rows
]

{ #category : 'accessing' }
TdComparisonTable >> rows: aCollectionOfComparisons [

	rows := aCollectionOfComparisons asArray
]

{ #category : 'queries' }
TdComparisonTable >> rowsForSplit: aSplit [

	^ rows select: [ :each | each split = aSplit ]
]

{ #category : 'initialization' }
TdComparisonTable >> setCandidate: aCandidateName baseline: aBaselineName [

	candidate := aCandidateName.
	baseline := aBaselineName
]

{ #category : 'summary' }
TdComparisonTable >> splits [

	^ ((rows collect: [ :each | each split ]) reject: [ :each | each isNil ]) asSet asSortedCollection asArray
]

{ #category : 'summary' }
TdComparisonTable >> summaryDictionary [
	"The summary of a gate report (INTERFACES.md §5.4)."

	^ OrderedDictionary new
		  at: 'n' put: self n;
		  at: 'agreement' put: self agreement;
		  at: 'forkTokens' put: self forkTokens;
		  at: 'rerunTokens' put: self rerunTokens;
		  at: 'forkCost' put: self forkCost;
		  at: 'rerunCost' put: self rerunCost;
		  at: 'tokenSavings' put: self tokenSavings;
		  at: 'baselinePassRate' put: self baselinePassRate;
		  at: 'candidateForkPassRate' put: self candidateForkPassRate;
		  at: 'candidateRerunPassRate' put: self candidateRerunPassRate;
		  yourself
]

{ #category : 'summary' }
TdComparisonTable >> tokenSavings [
	"1 - fork tokens / rerun tokens (0 without rerun tokens)."

	self rerunTokens = 0 ifTrue: [ ^ 0 ].
	^ self ratio: self rerunTokens - self forkTokens of: self rerunTokens
]
