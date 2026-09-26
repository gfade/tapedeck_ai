"
I am one row of a comparison between a baseline variant and a candidate: the baseline run of a task, the fork of it with the candidate, the candidate's full reruns, whether the fork's verdict agrees with the majority of the reruns, and the tokens the fork spent and saved. My dictionary is a row of a gate report (INTERFACES.md §5.4); I am built from runs, or read from a report (with the runs resolved when a store is given). Like the runner's gate, a tie among the reruns counts as fail, and a fork without a verdict never agrees.

	row := TdComparison baseline: baselineRun fork: forkRun reruns: { rerun }.
	row agree.
	row forkUsage.
	row asDictionary.
"
Class {
	#name : 'TdComparison',
	#superclass : 'Object',
	#instVars : [
		'row',
		'baselineRun',
		'forkRun',
		'rerunRuns'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdComparison class >> baseline: aRun fork: aForkRun reruns: aCollectionOfRuns [

	^ self new setBaseline: aRun fork: aForkRun reruns: aCollectionOfRuns
]

{ #category : 'instance creation' }
TdComparison class >> fromRow: aRowDictionary store: aStoreOrNil [
	"A row of a gate report; with a store, its run ids are resolved to runs."

	^ self new setRow: aRowDictionary store: aStoreOrNil
]

{ #category : 'accessing' }
TdComparison >> agree [
	"Whether the fork's verdict equals the majority verdict of the reruns."

	^ self field: 'agree'
]

{ #category : 'converting' }
TdComparison >> asDictionary [
	"The gate report row (INTERFACES.md §5.4)."

	^ row
]

{ #category : 'accessing' }
TdComparison >> baselinePass [

	^ self field: 'baselinePass'
]

{ #category : 'accessing' }
TdComparison >> baselineRun [
	"The baseline TdRun, when known."

	^ baselineRun
]

{ #category : 'accessing' }
TdComparison >> baselineRunId [

	^ self field: 'baselineRun'
]

{ #category : 'private' }
TdComparison >> computeAgreement [

	^ self forkPass notNil and: [ self forkPass = self majorityRerunVerdict ]
]

{ #category : 'accessing' }
TdComparison >> divergence [

	^ TdDivergence fromDictionary: (self field: 'divergence')
]

{ #category : 'private' }
TdComparison >> field: aKey [

	^ row at: aKey ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdComparison >> forkAt [

	^ self field: 'forkAt'
]

{ #category : 'accessing' }
TdComparison >> forkPass [

	^ self field: 'forkPass'
]

{ #category : 'accessing' }
TdComparison >> forkRun [
	"The fork TdRun, when known."

	^ forkRun
]

{ #category : 'accessing' }
TdComparison >> forkRunId [

	^ self field: 'forkRun'
]

{ #category : 'accessing' }
TdComparison >> forkUsage [
	"What the fork spent live."

	^ TdUsage fromDictionary: (self field: 'forkUsage')
]

{ #category : 'accessing' }
TdComparison >> majorityRerunVerdict [
	"Whether more than half of the reruns passed (a tie, or no rerun, counts as fail)."

	^ (self rerunPasses count: [ :each | each == true ]) * 2 > self rerunPasses size
]

{ #category : 'printing' }
TdComparison >> printOn: aStream [

	aStream
		nextPutAll: 'TdComparison(';
		nextPutAll: self task asString;
		nextPutAll: ' fork ';
		print: self forkPass;
		nextPutAll: ' reruns ';
		print: self rerunPasses;
		nextPutAll: ' agree ';
		print: self agree;
		nextPut: $)
]

{ #category : 'accessing' }
TdComparison >> rerunCostPerRun [
	"Dollars of one rerun (the reruns' cost averaged), 0 without reruns."

	self rerunRunIds isEmpty ifTrue: [ ^ 0 ].
	^ self rerunUsage cost / self rerunRunIds size
]

{ #category : 'accessing' }
TdComparison >> rerunPasses [

	^ (self field: 'rerunPass') ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdComparison >> rerunRunIds [

	^ (self field: 'rerunRuns') ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdComparison >> rerunRuns [
	"The rerun TdRuns, when known."

	^ rerunRuns ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdComparison >> rerunTokensPerRun [
	"Tokens of one rerun (the reruns' tokens averaged), 0 without reruns."

	self rerunRunIds isEmpty ifTrue: [ ^ 0 ].
	^ self rerunUsage totalTokens / self rerunRunIds size
]

{ #category : 'accessing' }
TdComparison >> rerunUsage [
	"What the reruns spent, summed."

	^ TdUsage fromDictionary: (self field: 'rerunUsage')
]

{ #category : 'accessing' }
TdComparison >> savedUsage [
	"The recorded usage of the steps the fork replayed instead of paying for them."

	^ TdUsage fromDictionary: (self field: 'savedUsage')
]

{ #category : 'initialization' }
TdComparison >> setBaseline: aRun fork: aForkRun reruns: aCollectionOfRuns [

	baselineRun := aRun.
	forkRun := aForkRun.
	rerunRuns := aCollectionOfRuns asArray.
	row := OrderedDictionary new
		       at: 'task' put: (aForkRun task ifNil: [ aRun task ]);
		       at: 'split' put: (aForkRun split ifNil: [ aRun split ]);
		       at: 'baselineRun' put: aRun id;
		       at: 'baselinePass' put: aRun pass;
		       at: 'forkRun' put: aForkRun id;
		       at: 'forkPass' put: aForkRun pass;
		       at: 'forkAt' put: aForkRun forkAt;
		       at: 'divergence' put: (aForkRun divergence ifNotNil: [ :divergence | divergence asDictionary ]);
		       at: 'forkUsage' put: aForkRun usage asDictionary;
		       at: 'savedUsage' put: aForkRun savedUsage asDictionary;
		       at: 'rerunRuns' put: (rerunRuns collect: [ :each | each id ]);
		       at: 'rerunPass' put: (rerunRuns collect: [ :each | each pass ]);
		       at: 'rerunUsage' put: (TdUsage sumOf: (rerunRuns collect: [ :each | each usage ])) asDictionary;
		       yourself.
	row at: 'agree' put: self computeAgreement
]

{ #category : 'initialization' }
TdComparison >> setRow: aRowDictionary store: aStoreOrNil [

	row := TdJson copy: aRowDictionary.
	aStoreOrNil ifNil: [ ^ self ].
	baselineRun := aStoreOrNil runWithId: self baselineRunId.
	forkRun := aStoreOrNil runWithId: self forkRunId.
	rerunRuns := (self rerunRunIds collect: [ :each | aStoreOrNil runWithId: each ]) reject: [ :each |
		             each isNil ]
]

{ #category : 'accessing' }
TdComparison >> split [

	^ self field: 'split'
]

{ #category : 'accessing' }
TdComparison >> task [

	^ self field: 'task'
]

{ #category : 'accessing' }
TdComparison >> variant [
	"The candidate variant, when the fork run is known."

	^ forkRun ifNotNil: [ :run | run variant ]
]

{ #category : 'queries' }
TdComparison >> tokenSavings [
	"1 - fork tokens / tokens of one rerun, or nil without rerun tokens."

	self rerunTokensPerRun = 0 ifTrue: [ ^ nil ].
	^ ((1 - (self forkUsage totalTokens / self rerunTokensPerRun)) * 10000) rounded / 10000.0
]
