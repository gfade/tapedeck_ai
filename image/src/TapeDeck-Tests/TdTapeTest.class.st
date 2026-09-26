"
I test TdTape: the tape JSON of a run, its round trip, and edits that keep the response and the tool records consistent.
"
Class {
	#name : 'TdTapeTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdTapeTest >> npmCallId [

	^ (self baseline stepAt: 4) tools first id
]

{ #category : 'tests' }
TdTapeTest >> testEditingAResult [

	| tape tool |
	tape := TdTape fromRun: self baseline.
	tape editToolCall: self npmCallId result: '# pass 3' note: 'what if the tests had passed?'.
	tool := tape toolCallAt: self npmCallId.
	self assert: (((tool at: 'result') at: 'content') first at: 'text') equals: '# pass 3'.
	self assert: ((tool at: 'result') at: 'isError') equals: false.
	self assert: (tape edits first at: 'field') equals: 'result'.
	self assert: (self baseline stepAt: 4) tools first isError
]

{ #category : 'tests' }
TdTapeTest >> testEditingAToolCallChangesResponseAndTools [

	| tape step tool block |
	tape := TdTape fromRun: self baseline.
	tape editToolCall: self npmCallId command: './tasks test'.
	step := tape stepAt: 4.
	tool := (step at: 'tools') detect: [ :each | (each at: 'id') = self npmCallId ].
	block := ((step at: 'response') at: 'content') detect: [ :each |
		         (each at: 'type') = 'toolCall' and: [ (each at: 'id') = self npmCallId ] ].
	self assert: ((tool at: 'args') at: 'command') equals: './tasks test'.
	self assert: ((block at: 'arguments') at: 'command') equals: './tasks test'.
	self assert: tape isEdited.
	self assert: tape edits size equals: 1.
	self assert: (tape edits first at: 'step') equals: 4.
	self assert: (tape edits first at: 'toolId') equals: self npmCallId.
	self assert: (tape edits first at: 'field') equals: 'args'.
	self assert: (self baseline stepAt: 4) tools first command equals: 'npm test'.
	self assert: (self baseline stepAt: 4) response toolCalls first command equals: 'npm test'
]

{ #category : 'tests' }
TdTapeTest >> testEditingAnUnknownCallFails [

	self should: [ (TdTape fromRun: self baseline) editToolCall: 'no-such-call' command: 'ls' ] raise: Error
]

{ #category : 'tests' }
TdTapeTest >> testEditsSurviveTheJsonRoundTrip [

	| tape copy |
	tape := TdTape fromRun: self baseline.
	tape editToolCall: self npmCallId args: (TdJson fromString: '{"command":"./tasks test","timeout":60}') note: 'use the task runner'.
	copy := TdTape fromJsonString: tape asJsonString.
	self assert: copy edits size equals: 1.
	self assert: (((copy toolCallAt: self npmCallId) at: 'args') at: 'timeout') equals: 60
]

{ #category : 'tests' }
TdTapeTest >> testTapeFromRun [

	| tape step recorded |
	tape := TdTape fromRun: self baseline.
	self assert: (tape asDictionary at: 'format') equals: TdTape format.
	self assert: tape id equals: self baseline id.
	self assert: tape run == self baseline.
	self assert: tape stepCount equals: self baseline stepCount.
	self assert: tape cwd equals: self baseline cwd.
	self assert: (tape asDictionary at: 'sessionId') equals: self baseline sessionId.
	self assert: (tape asDictionary at: 'snapshotBase') equals: self baseline snapshotBase.
	self assert: tape edits isEmpty.
	step := tape stepAt: 2.
	recorded := self baseline stepAt: 2.
	self assert: (step at: 'request') size equals: recorded request size.
	self assert: (step at: 'requestHash') equals: recorded requestHash.
	self assert: (step at: 'live') equals: true.
	self assert: (((step at: 'response') at: 'usage') at: 'totalTokens') equals: recorded tokens.
	self
		assert: ((((step at: 'tools') first at: 'result') at: 'content') first at: 'text')
		equals: recorded tools first resultText.
	self assert: ((step at: 'tools') first at: 'exec') equals: 'real'.
	self assert: ((step at: 'tools') first at: 'snapshot') equals: recorded tools first snapshot
]

{ #category : 'tests' }
TdTapeTest >> testTapeJsonRoundTrip [

	| tape copy |
	tape := TdTape fromRun: self fork.
	copy := TdTape fromJsonString: tape asJsonString.
	self assert: (TdJson toCanonicalString: copy asDictionary) equals: (TdJson toCanonicalString: tape asDictionary).
	self assert: (TdTape fromJsonString: tape asJsonStringPretty) asJsonString equals: tape asJsonString.
	self assert: ((copy stepAt: 1) at: 'live') equals: false.
	self assert: (((copy stepAt: 1) at: 'tools') first at: 'exec') equals: 'stub'
]

{ #category : 'tests' }
TdTapeTest >> testWriteToFile [

	| tape file |
	tape := TdTape fromRun: self baseline.
	file := FileLocator temp asFileReference / ('tapedeck-test-' , UUID new asString , '.json').
	[
	tape writeToFile: file.
	self assert: (TdTape fromFile: file) asJsonString equals: tape asJsonString ] ensure: [
		file ensureDelete ]
]
