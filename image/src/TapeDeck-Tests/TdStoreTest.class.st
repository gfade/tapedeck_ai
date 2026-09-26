"
I test TdStore: importing a runner store, queries, reports, refresh and the tapes edited in the image.
"
Class {
	#name : 'TdStoreTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdStoreTest >> testImportsEveryRunSortedById [

	| ids |
	self assert: self store size equals: (self class fixturesDirectory / 'runs') directories size.
	ids := self store runs collect: [ :each | each id ].
	self assert: ids equals: ids asSortedCollection asArray.
	self assert: (self store runs allSatisfy: [ :each | each store == self store ])
]

{ #category : 'tests' }
TdStoreTest >> testQueries [

	self assert: ((self store runsForTask: self baseline task) includes: self baseline).
	self assert: ((self store baselinesFor: 'vanilla') includes: self baseline).
	self deny: ((self store baselinesFor: self fork variant) includes: self fork).
	self assert: ((self store forksOf: self baseline) includes: self fork).
	self assert: (self store forksOf: self baseline id) equals: (self store forksOf: self baseline).
	self assert: ((self store replaysOf: self baseline) includes: self replay).
	self assert: ((self store childrenOf: self baseline) includesAll: { self fork. self replay }).
	self assert: (self store baselineForTask: self baseline task variant: 'vanilla') equals: self baseline.
	self assert: (self store failedRuns includes: self baseline).
	self deny: (self store failedRuns includes: self replay).
	self assert: (self store passedRuns includes: self fork).
	self assert: self baseline forks equals: (self store forksOf: self baseline).
	self
		assert: self store allToolCalls size
		equals: (self store runs inject: 0 into: [ :sum :each | sum + each toolCalls size ]).
	self assert: (self store tasks includes: self baseline task).
	self assert: (self store variants includesAll: #( 'vanilla' 'rule-taskrunner' ))
]

{ #category : 'tests' }
TdStoreTest >> testRefreshKeepsFinishedRuns [

	| before |
	before := self store runs.
	self store refresh.
	self assert: self store runs size equals: before size.
	self assert: ((self store runs with: before collect: [ :a :b | a == b ]) allSatisfy: [ :each | each ])
]

{ #category : 'tests' }
TdStoreTest >> testReports [

	self
		assert: self store reports size
		equals: ((self class fixturesDirectory / 'reports') filesMatching: '*.json') size.
	self assert: (self gateReport at: 'format') equals: 'tapedeck.gate/v1'.
	self assert: (self store reportNamed: (self gateReport at: 'name')) equals: self gateReport
]

{ #category : 'tests' }
TdStoreTest >> testRunNamed [

	| run |
	run := self store runs first.
	self assert: (self store runNamed: run id) equals: run.
	self assert: (self store runNamed: (run id allButFirst: 2)) equals: run.
	self assert: (self store runWithId: (run id allButFirst: 2)) isNil.
	self assert: (self store runNamed: 'no-such-run') isNil
]

{ #category : 'tests' }
TdStoreTest >> testTapesEditedInTheImageWin [

	| tape |
	self deny: (self store tapeNamed: self baseline id) isEdited.
	tape := self store tapeNamed: self baseline id.
	tape editToolCall: (self baseline stepAt: 4) tools first id command: './tasks test'.
	self store registerTape: tape.
	self assert: (self store tapeNamed: self baseline id) == tape.
	self assert: (self store editedTapeNamed: self baseline id) == tape.
	self store forgetTape: self baseline id.
	self deny: (self store tapeNamed: self baseline id) isEdited.
	self assert: (self store tapeNamed: 'no-such-tape') isNil
]
