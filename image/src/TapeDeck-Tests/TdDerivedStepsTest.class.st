"
I test sessions without pi-tape entries: steps are derived from the completed assistant messages of the active branch, with their tool calls and results but no requests or snapshots, and the harness state comes from the session's system messages.
"
Class {
	#name : 'TdDerivedStepsTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdDerivedStepsTest >> baselineWithoutTape [

	^ TdRun fromSession: self sessionWithoutTapeEntries id: 'no-tape'
]

{ #category : 'fixtures' }
TdDerivedStepsTest >> sessionWithoutTapeEntries [
	"The baseline session with pi-tape's entries removed and the parent links repaired."

	| kept previousId |
	kept := OrderedCollection with: (TdJson copy: self baseline session header).
	previousId := nil.
	self baseline session entries do: [ :each |
		((each at: 'customType' ifAbsent: [ '' ]) beginsWith: 'tape.') ifFalse: [
			| copy |
			copy := TdJson copy: each.
			copy at: 'parentId' put: previousId.
			previousId := copy at: 'id'.
			kept add: copy ] ].
	^ TdSessionFile fromEntries: kept
]

{ #category : 'tests' }
TdDerivedStepsTest >> testBranchedSession [

	| run diff |
	run := TdRun fromSession: (TdSessionFile fromString: self branchedSessionText) id: 'branched'.
	self assert: run stepCount equals: 2.
	self assert: (run stepAt: 1) tools first command equals: 'ls /work/src'.
	self assert: (run stepAt: 1) tools first resultText equals: 'sum.js'.
	self assert: (run stepAt: 1) tools first exec isNil.
	self assert: (run stepAt: 2) response text equals: 'Done.'.
	self assert: run model equals: 'p/m'.
	self assert: run tokens equals: 27.
	self assert: ((run harnessStateAt: 1) sectionAt: 'cwd') equals: '<cwd>'.
	self assert: (run harnessStateAt: 1) toolNames asArray equals: #( 'bash' ).
	diff := (run harnessStateAt: 1) diff: (run harnessStateAt: 2).
	self assert: diff sectionsRemoved equals: #( 'preamble' ).
	self assert: diff sectionsAdded equals: #( 'rules' ).
	self assert: diff toolsRemoved equals: #( 'bash' ).
	self assert: run harnessChanges changes size equals: diff changes size
]

{ #category : 'tests' }
TdDerivedStepsTest >> testHarnessStateFromSystemMessages [

	| derived recorded |
	derived := self baselineWithoutTape harnessStateAt: 1.
	recorded := self baseline harnessStateAt: 1.
	self assert: derived sectionNames asArray equals: recorded sectionNames asArray.
	self assert: derived toolNames asArray equals: recorded toolNames asArray.
	self assert: (derived sectionAt: 'cwd') equals: (recorded sectionAt: 'cwd')
]

{ #category : 'tests' }
TdDerivedStepsTest >> testStepsFromAssistantMessages [

	| run recordedCall call |
	run := self baselineWithoutTape.
	self assert: run header isNil.
	self assert: run stepCount equals: self baseline stepCount.
	self assert: (run steps allSatisfy: [ :each | each isLive and: [ each hasRequest not ] ]).
	self assert: ((run stepAt: 1) requestText includesSubstring: 'no recorded request').
	recordedCall := (self baseline stepAt: 4) tools first.
	call := (run stepAt: 4) tools first.
	self assert: call command equals: recordedCall command.
	self assert: call isError.
	self assert: call resultText equals: recordedCall resultText.
	self assert: call snapshot isNil.
	self assert: (run stepAt: 4) snapshotAfter isNil.
	self assert: run tokens equals: self baseline tokens.
	self deny: run hasTape.
	self should: [ TdTape fromRun: run ] raise: Error
]
