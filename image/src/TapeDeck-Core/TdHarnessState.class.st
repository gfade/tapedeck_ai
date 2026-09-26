"
I am the harness as the model saw it at one point of a run: prompt text appended by system messages (contents), the named prompt sections in order, and the declared tools by name. I am rebuilt by replaying system messages in order (INTERFACES.md §3, pi's getCurrentSystemMessage): sections are patched by name and a nil value removes one, toolsRemoved and then toolsAdded update the tools, and replace: true starts again from nothing.

	(aRun harnessStateAt: 3) sectionNames.
	(aRun harnessStateAt: 3) promptText.
	(baseline harnessStateAt: 1) diff: (fork harnessStateAt: 1).
"
Class {
	#name : 'TdHarnessState',
	#superclass : 'Object',
	#instVars : [
		'contents',
		'sections',
		'tools'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdHarnessState class >> fromMessages: aCollectionOfMessages [
	"Replay the system messages among aCollectionOfMessages (TdMessage objects)."

	^ self new
		  applyAll: aCollectionOfMessages;
		  yourself
]

{ #category : 'replaying' }
TdHarnessState >> apply: aMessage [
	"Apply one system message; other roles leave the harness unchanged."

	aMessage isSystem ifFalse: [ ^ self ].
	aMessage isReplace ifTrue: [ self reset ].
	aMessage text ifNotEmpty: [ :text | contents add: text ].
	aMessage sectionPairs do: [ :pair | self patchSection: pair key with: pair value ].
	aMessage toolsRemovedNames do: [ :each | tools removeKey: each ifAbsent: [ nil ] ].
	aMessage toolsAdded do: [ :each |
		(each at: 'name' ifAbsent: [ nil ]) ifNotNil: [ :name | tools at: name put: each ] ]
]

{ #category : 'replaying' }
TdHarnessState >> applyAll: aCollectionOfMessages [

	aCollectionOfMessages do: [ :each | self apply: each ]
]

{ #category : 'replaying' }
TdHarnessState >> applyCheckpoint: aMessage [
	"A compaction's system message holds the complete state: it replaces mine."

	self reset.
	self apply: aMessage
]

{ #category : 'converting' }
TdHarnessState >> asDictionary [

	^ OrderedDictionary new
		  at: 'content' put: self content;
		  at: 'sections' put: (sections associations collect: [ :each | { each key. each value } ]) asArray;
		  at: 'tools' put: tools values asArray;
		  yourself
]

{ #category : 'accessing' }
TdHarnessState >> content [
	"The prompt text appended by system messages (not the sections)."

	^ String lf , String lf join: contents
]

{ #category : 'comparing' }
TdHarnessState >> diff: aNewerState [
	"What changed from me to aNewerState."

	^ TdHarnessDiff from: self to: aNewerState
]

{ #category : 'testing' }
TdHarnessState >> hasSection: aName [

	^ sections includesKey: aName
]

{ #category : 'testing' }
TdHarnessState >> hasTool: aName [

	^ tools includesKey: aName
]

{ #category : 'initialization' }
TdHarnessState >> initialize [

	super initialize.
	self reset
]

{ #category : 'comparing' }
TdHarnessState >> isEquivalentTo: aState [

	^ (self diff: aState) isEmpty
]

{ #category : 'private' }
TdHarnessState >> patchSection: aName with: aTextOrNil [

	aTextOrNil
		ifNil: [ sections removeKey: aName ifAbsent: [ nil ] ]
		ifNotNil: [ sections at: aName put: aTextOrNil ]
]

{ #category : 'copying' }
TdHarnessState >> postCopy [

	contents := contents copy.
	sections := sections copy.
	tools := tools copy
]

{ #category : 'printing' }
TdHarnessState >> printOn: aStream [

	aStream
		nextPutAll: 'TdHarnessState(';
		print: sections size;
		nextPutAll: ' sections, ';
		print: tools size;
		nextPutAll: ' tools)'
]

{ #category : 'accessing' }
TdHarnessState >> promptText [
	"The system prompt as pi renders it: the appended text, then each section, separated by blank lines."

	| parts |
	parts := OrderedCollection new.
	parts addAll: contents.
	parts addAll: sections values.
	^ String lf , String lf join: (parts reject: [ :each | each isEmpty ])
]

{ #category : 'initialization' }
TdHarnessState >> reset [

	contents := OrderedCollection new.
	sections := OrderedDictionary new.
	tools := OrderedDictionary new
]

{ #category : 'accessing' }
TdHarnessState >> sectionAt: aName [

	^ sections at: aName ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdHarnessState >> sectionNames [

	^ sections keys
]

{ #category : 'accessing' }
TdHarnessState >> sections [
	"Section name -> text, in prompt order."

	^ sections
]

{ #category : 'accessing' }
TdHarnessState >> toolAt: aName [
	"The tool declaration (name, description, parameters), or nil."

	^ tools at: aName ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdHarnessState >> toolNames [

	^ tools keys
]

{ #category : 'accessing' }
TdHarnessState >> tools [
	"Tool name -> declaration."

	^ tools
]
