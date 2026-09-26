"
I test TdHarnessState (replaying system messages) and TdHarnessDiff.
"
Class {
	#name : 'TdHarnessStateTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdHarnessStateTest >> message: aJsonString [

	^ TdMessage fromDictionary: (TdJson fromString: aJsonString)
]

{ #category : 'tests' }
TdHarnessStateTest >> testForkAddsTheRulesSection [

	| diff |
	diff := (self baseline harnessStateAt: 1) diff: (self fork harnessStateAt: 1).
	self assert: diff sectionsAdded equals: #( 'tapedeck-rules' ).
	self assert: diff sectionsRemoved isEmpty.
	self assert: diff sectionsChanged isEmpty.
	self assert: diff toolsAdded isEmpty.
	self assert: diff toolsRemoved isEmpty.
	self deny: diff contentChanged.
	self assert: diff changes size equals: 1.
	self assert: diff changes first description equals: '+ section tapedeck-rules'.
	self assert: ((self fork harnessStateAt: 1) sectionAt: 'tapedeck-rules') notEmpty
]

{ #category : 'tests' }
TdHarnessStateTest >> testHarnessDiffOfARun [

	self assert: self fork harnessDiffFromParent sectionsAdded equals: #( 'tapedeck-rules' ).
	self assert: self fork harnessDiff sectionsAdded equals: #( 'tapedeck-rules' ).
	self assert: self baseline harnessDiffFromParent isNil.
	self assert: self baseline harnessDiff isEmpty.
	self assert: self replay harnessDiffFromParent isEmpty
]

{ #category : 'tests' }
TdHarnessStateTest >> testReplaceStartsAgain [

	| state |
	state := TdHarnessState fromMessages: {
			         (self message: '{"role":"system","content":"Base.","sections":[["a","A"]],"toolsAdded":[{"name":"x","description":"X"}]}').
			         (self message: '{"role":"system","content":"New.","replace":true,"sections":[["d","D"]]}') }.
	self assert: state sectionNames asArray equals: #( 'd' ).
	self assert: state toolNames isEmpty.
	self assert: state content equals: 'New.'
]

{ #category : 'tests' }
TdHarnessStateTest >> testReplayingSystemMessages [

	| state |
	state := TdHarnessState fromMessages: {
			         (self message: '{"role":"system","content":"Base.","sections":[["a","A"],["b","B"]],"toolsAdded":[{"name":"x","description":"X"},{"name":"y","description":"Y"}]}').
			         (self message: '{"role":"user","content":[{"type":"text","text":"hi"}]}').
			         (self message: '{"role":"system","content":"More.","sections":[["a",null],["c","C"],["b","B2"]],"toolsRemoved":["x"],"toolsAdded":[{"name":"z","description":"Z"}]}') }.
	self assert: state sectionNames asArray equals: #( 'b' 'c' ).
	self assert: (state sectionAt: 'b') equals: 'B2'.
	self assert: (state sectionAt: 'a') isNil.
	self assert: state toolNames asArray equals: #( 'y' 'z' ).
	self assert: state content equals: 'Base.' , String lf , String lf , 'More.'.
	self
		assert: state promptText
		equals: ((String lf , String lf) join: #( 'Base.' 'More.' 'B2' 'C' ))
]

{ #category : 'tests' }
TdHarnessStateTest >> testSessionFormOfSystemMessages [
	"In a session, sections are an object and toolsRemoved lists {name} objects."

	| state |
	state := TdHarnessState fromMessages: {
			         (self message: '{"role":"system","content":"","sections":{"p":"P","q":"Q"},"toolsAdded":[{"name":"x"}]}').
			         (self message: '{"role":"system","content":[{"type":"text","text":"Note."}],"sections":{"p":null},"toolsRemoved":[{"name":"x"}]}') }.
	self assert: state sectionNames asArray equals: #( 'q' ).
	self assert: state toolNames isEmpty.
	self assert: state content equals: 'Note.'
]

{ #category : 'tests' }
TdHarnessStateTest >> testStateAtEveryStep [

	| state |
	state := self baseline harnessStateAt: 3.
	self assert: (state hasSection: 'cwd').
	self assert: state toolNames asArray equals: #( 'read' 'bash' 'edit' 'write' ).
	self assert: (state promptText includesSubstring: (state sectionAt: 'preamble')).
	self assert: (state isEquivalentTo: (self baseline harnessStateAt: 1)).
	self assert: (self baseline harnessStateAt: 99) isNil
]
