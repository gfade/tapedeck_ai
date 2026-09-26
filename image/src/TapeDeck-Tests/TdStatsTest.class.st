"
I test TdStats: tokens by step, histograms and the determinism ratio.
"
Class {
	#name : 'TdStatsTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdStatsTest >> testCommandHistogram [

	| programs |
	programs := self baseline stats commandHistogram collect: [ :each | each key ].
	self assert: (programs includes: 'npm')
]

{ #category : 'tests' }
TdStatsTest >> testDeterminismRatio [

	self assert: self baseline stats determinismRatio equals: 0.
	self assert: self replay stats determinismRatio equals: 1.0.
	self
		assert: self fork stats determinismRatio
		equals: (self fork replayedSteps size / self fork stepCount * 10000) rounded / 10000.0.
	self assert: self store stats stepCount equals: self store steps size
]

{ #category : 'tests' }
TdStatsTest >> testTokensByStep [

	| byStep |
	byStep := self baseline stats tokensByStep.
	self assert: (byStep collect: [ :each | each key ]) asArray equals: (1 to: self baseline stepCount) asArray.
	self
		assert: (byStep inject: 0 into: [ :sum :each | sum + each value ])
		equals: self baseline recordedUsage totalTokens.
	self assert: (TdStats on: { self baseline. self rerun }) tokensByStep first value
		equals: (self baseline stepAt: 1) tokens + (self rerun stepAt: 1) tokens
]

{ #category : 'tests' }
TdStatsTest >> testToolHistogram [

	| histogram |
	histogram := self baseline stats toolHistogram.
	self
		assert: (histogram detect: [ :each | each key = 'bash' ]) value
		equals: (self baseline toolCalls count: [ :each | each name = 'bash' ]).
	self assert: (histogram inject: 0 into: [ :sum :each | sum + each value ]) equals: self baseline toolCalls size.
	self assert: histogram first value >= histogram last value
]
