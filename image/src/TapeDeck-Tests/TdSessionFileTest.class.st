"
I test TdSessionFile: header, entries, id index, active branch and pi-tape's custom entries.
"
Class {
	#name : 'TdSessionFileTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdSessionFileTest >> testActiveBranchFollowsParentsFromTheLastEntry [

	| session |
	session := TdSessionFile fromString: self branchedSessionText.
	self assert: session entries size equals: 8.
	self
		assert: (session activeBranch collect: [ :each | each at: 'id' ])
		equals: #( 'a' 'b' 'd' 'e' 'f' 'g' 'h' ).
	self assert: session cwd equals: '/work'.
	self assert: (session toolResultFor: 'call-1') notNil
]

{ #category : 'tests' }
TdSessionFileTest >> testActiveBranchOfALinearSession [

	| session |
	session := self baseline session.
	self assert: session activeBranch size equals: session entries size.
	self assert: session activeBranch last equals: session lastEntry.
	self assert: (session activeBranch first at: 'parentId') isNil
]

{ #category : 'tests' }
TdSessionFileTest >> testCustomEntries [

	| session |
	session := self baseline session.
	self assert: session hasTape.
	self assert: (session customEntriesOfType: 'tape.header') size equals: 1.
	self assert: session tapeSteps size equals: self baseline stepCount.
	self assert: (session tapeSteps collect: [ :each | each at: 'step' ]) asArray equals: (1 to: self baseline stepCount) asArray.
	self assert: (session tapeHeader at: 'mode') equals: 'record'.
	self assert: session tapeDivergence isNil.
	self assert: self fork session tapeDivergence notNil
]

{ #category : 'tests' }
TdSessionFileTest >> testReadsHeaderAndEntries [

	| session |
	session := self baseline session.
	self assert: session version equals: 3.
	self assert: session sessionId notNil.
	self assert: session cwd notNil.
	self assert: session location notNil.
	self assert: (session entryAt: (session lastEntry at: 'id')) == session lastEntry.
	self assert: (session entryAt: 'no-such-entry') isNil.
	self assert: session messages first isSystem
]

{ #category : 'tests' }
TdSessionFileTest >> testSkipsUnreadableLines [

	| session |
	session := TdSessionFile fromString: self branchedSessionText , String lf , '{"type":"message","id":"trunc'.
	self assert: session skippedLines equals: 1.
	self assert: session entries size equals: 8
]
