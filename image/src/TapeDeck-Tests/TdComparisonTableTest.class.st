"
I test TdComparison and TdComparisonTable, built from the runs of a store and from a runner gate report.
"
Class {
	#name : 'TdComparisonTableTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdComparisonTableTest >> gateRowKeys [
	"The row fields of a gate report (INTERFACES.md §5.4), in order."

	^ #( 'task' 'split' 'baselineRun' 'baselinePass' 'forkRun' 'forkPass' 'forkAt' 'divergence' 'forkUsage'
	     'savedUsage' 'rerunRuns' 'rerunPass' 'rerunUsage' 'agree' )
]

{ #category : 'fixtures' }
TdComparisonTableTest >> gateSummaryKeys [

	^ #( 'n' 'agreement' 'forkTokens' 'rerunTokens' 'forkCost' 'rerunCost' 'tokenSavings' 'baselinePassRate'
	     'candidateForkPassRate' 'candidateRerunPassRate' )
]

{ #category : 'fixtures' }
TdComparisonTableTest >> tableFromStore [

	^ TdComparisonTable forCandidate: self fork variant baseline: self baseline variant in: self store
]

{ #category : 'tests' }
TdComparisonTableTest >> testMajorityVerdictOfReruns [

	| row |
	row := [ :forkPass :rerunPasses |
	       TdComparison
		       fromRow: (OrderedDictionary new
				        at: 'forkPass' put: forkPass;
				        at: 'rerunPass' put: rerunPasses;
				        yourself)
		       store: nil ].
	self assert: (row value: true value: #( true false false )) majorityRerunVerdict equals: false.
	self assert: (row value: true value: #( true true false )) majorityRerunVerdict equals: true.
	self assert: (row value: true value: #( true false )) majorityRerunVerdict equals: false.
	self assert: (row value: true value: #(  )) majorityRerunVerdict equals: false
]

{ #category : 'tests' }
TdComparisonTableTest >> testRowsMatchTheGateReport [
	"Rows computed in the image from the runs of a gate report equal the report's rows."

	(TdComparisonTable fromGateReport: self gateReport in: self store) rows do: [ :fromReport |
		| fromRuns |
		fromRuns := TdComparison
			            baseline: fromReport baselineRun
			            fork: fromReport forkRun
			            reruns: fromReport rerunRuns.
		#( #task #split #baselineRunId #baselinePass #forkRunId #forkPass #forkAt #rerunRunIds #rerunPasses #agree )
			do: [ :selector | self assert: (fromRuns perform: selector) equals: (fromReport perform: selector) ].
		self assert: fromRuns forkUsage totalTokens equals: fromReport forkUsage totalTokens.
		self assert: fromRuns savedUsage totalTokens equals: fromReport savedUsage totalTokens.
		self assert: fromRuns rerunUsage totalTokens equals: fromReport rerunUsage totalTokens.
		self assert: fromRuns divergence kind equals: fromReport divergence kind ]
]

{ #category : 'tests' }
TdComparisonTableTest >> testTableFromTheGateReport [

	| table summary |
	table := TdComparisonTable fromGateReport: self gateReport in: self store.
	summary := self gateReport at: 'summary'.
	self assert: table agreement equals: (summary at: 'agreement').
	self assert: table n equals: (summary at: 'n').
	self assert: table candidate equals: (self gateReport at: 'candidate').
	self assert: table baseline equals: (self gateReport at: 'baseline').
	self assert: (table rows allSatisfy: [ :each | each forkRun notNil and: [ each baselineRun notNil ] ]).
	self assert: table forkTokens equals: (summary at: 'forkTokens').
	self assert: table rerunTokens equals: (summary at: 'rerunTokens').
	self assert: (table tokenSavings - (summary at: 'tokenSavings')) abs < 0.001.
	self assert: (table forkCost - (summary at: 'forkCost')) abs < 0.000001.
	self assert: table baselinePassRate keys asArray equals: (summary at: 'baselinePassRate') keys asArray.
	self assert: (TdComparisonTable fromGateReport: self gateReport) rows first forkRun isNil
]

{ #category : 'tests' }
TdComparisonTableTest >> testTableFromTheStore [

	| table row splitRows |
	table := self tableFromStore.
	self assert: table n equals: (table rows collect: [ :each | each task ]) asSet size.
	row := table rows detect: [ :each | each forkRun = self fork ].
	self assert: row baselineRun equals: self baseline.
	self assert: (row rerunRuns includes: self rerun).
	self assert: (row rerunRuns allSatisfy: [ :each | each isRecorded and: [ each variant = self fork variant ] ]).
	self assert: row asDictionary keys asArray equals: self gateRowKeys.
	self assert: row agree equals: (row forkPass = row majorityRerunVerdict).
	self assert: row forkPass.
	self deny: row baselinePass.
	self assert: row agree.
	self assert: table forkTokens equals: (table rows inject: 0 into: [ :sum :each | sum + each forkRun tokens ]).
	self
		assert: table tokenSavings
		equals: (1 - (table forkTokens / table rerunTokens) * 10000) rounded / 10000.0.
	splitRows := table rowsForSplit: self baseline split.
	self
		assert: (table candidateForkPassRate at: self baseline split)
		equals: ((splitRows count: [ :each | each forkPass == true ]) / splitRows size * 10000) rounded / 10000.0
]

{ #category : 'tests' }
TdComparisonTableTest >> testTableHasTheGateReportShape [

	| dictionary |
	dictionary := self tableFromStore asDictionary.
	self
		assert: dictionary keys asArray
		equals: #( 'format' 'name' 'candidate' 'baseline' 'model' 'createdAt' 'rows' 'summary' ).
	self assert: (dictionary at: 'format') equals: 'tapedeck.gate/v1'.
	self assert: (dictionary at: 'summary') keys asArray equals: self gateSummaryKeys.
	self assert: (dictionary at: 'model') equals: self fork model.
	self assert: (TdJson fromString: (TdJson toString: dictionary)) notNil
]

{ #category : 'tests' }
TdComparisonTableTest >> testTableOfEveryFork [

	| table |
	table := TdComparisonTable forStore: self store.
	self
		assert: table n
		equals: ((self store forks select: [ :each | each parent notNil ]) collect: [ :each |
				  { each task. each parent variant. each variant } ]) asSet size.
	self assert: ((table rows collect: [ :each | each forkRun ]) includes: self fork).
	self assert: self store comparisonTable n equals: table n.
	self
		assert: (self store comparisonTableForReport: (self gateReport at: 'name')) agreement
		equals: ((self gateReport at: 'summary') at: 'agreement')
]
