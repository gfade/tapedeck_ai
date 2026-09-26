"
I test TdAlignment: where two runs first differ, and why.
"
Class {
	#name : 'TdAlignmentTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdAlignmentTest >> runFromSessionText: aString [

	^ TdRun fromSession: (TdSessionFile fromString: aString) id: 'derived'
]

{ #category : 'tests' }
TdAlignmentTest >> testForkAndRerunAgree [

	| alignment |
	alignment := self fork alignmentWith: self rerun.
	self assert: alignment isIdentical.
	self assert: alignment divergenceStep isNil.
	self assert: alignment sharedSteps equals: self rerun stepCount.
	self assert: (alignment reason beginsWith: 'no difference')
]

{ #category : 'tests' }
TdAlignmentTest >> testForkLeavesItsBaselineAtTheForkStep [

	| alignment |
	alignment := (TdAlignment of: self baseline with: self fork)
		             lenient: #( 'system' );
		             yourself.
	self assert: alignment divergenceStep equals: self fork divergence step.
	self assert: alignment firstDifference isInResponse.
	self assert: alignment sharedSteps equals: self fork divergence step - 1.
	self assert: (alignment reason includesSubstring: 'npm test').
	self assert: (alignment reason includesSubstring: './tasks test')
]

{ #category : 'tests' }
TdAlignmentTest >> testIdsAreIgnoredByDefault [

	| original renamed |
	original := self runFromSessionText: self branchedSessionText.
	renamed := self runFromSessionText: (self branchedSessionText copyReplaceAll: 'call-1' with: 'call-X').
	self assert: (TdAlignment of: original with: renamed) isIdentical.
	self assert: ((TdAlignment of: original with: renamed)
			 ignoreIds: false;
			 divergenceStep) equals: 1
]

{ #category : 'tests' }
TdAlignmentTest >> testMissingSteps [

	| full truncated difference |
	full := self runFromSessionText: self branchedSessionText.
	truncated := self runFromSessionText: (String lf join: (self branchedSessionText lines first: 6)).
	difference := (TdAlignment of: full with: truncated) firstDifference.
	self assert: difference step equals: 2.
	self assert: difference part equals: #missing
]

{ #category : 'tests' }
TdAlignmentTest >> testReplayMatchesItsTape [

	self assert: (TdAlignment of: self baseline with: self replay) isIdentical
]

{ #category : 'tests' }
TdAlignmentTest >> testSystemMessagesCountUnlessLenient [

	| alignment |
	alignment := TdAlignment of: self baseline with: self fork.
	self assert: alignment divergenceStep equals: 1.
	self assert: alignment firstDifference isInRequest.
	self assert: alignment firstDifference messageIndex equals: 0.
	self assert: (alignment reason includesSubstring: '+ section tapedeck-rules')
]
