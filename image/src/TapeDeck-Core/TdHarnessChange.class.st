"
I am one difference between two harness states: a prompt section or a tool (subject #section or #tool) that was #added, #removed or #changed, or a change of the appended prompt text (subject #content). before and after hold the section text or tool declaration on each side.

	aChange description.	""'+ section tapedeck-rules'""
"
Class {
	#name : 'TdHarnessChange',
	#superclass : 'Object',
	#instVars : [
		'subject',
		'change',
		'name',
		'before',
		'after'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdHarnessChange class >> subject: aSubject change: aChange name: aName before: anOldValue after: aNewValue [

	^ self new
		  setSubject: aSubject
		  change: aChange
		  name: aName
		  before: anOldValue
		  after: aNewValue
]

{ #category : 'accessing' }
TdHarnessChange >> after [

	^ after
]

{ #category : 'printing' }
TdHarnessChange >> afterSummary [

	^ self summaryOf: after
]

{ #category : 'accessing' }
TdHarnessChange >> before [

	^ before
]

{ #category : 'printing' }
TdHarnessChange >> beforeSummary [

	^ self summaryOf: before
]

{ #category : 'accessing' }
TdHarnessChange >> change [
	"#added, #removed or #changed."

	^ change
]

{ #category : 'printing' }
TdHarnessChange >> description [

	^ self symbol , ' ' , subject asString , ' ' , name asString
]

{ #category : 'testing' }
TdHarnessChange >> isAdded [

	^ change = #added
]

{ #category : 'testing' }
TdHarnessChange >> isChanged [

	^ change = #changed
]

{ #category : 'testing' }
TdHarnessChange >> isRemoved [

	^ change = #removed
]

{ #category : 'testing' }
TdHarnessChange >> isSection [

	^ subject = #section
]

{ #category : 'testing' }
TdHarnessChange >> isTool [

	^ subject = #tool
]

{ #category : 'accessing' }
TdHarnessChange >> name [

	^ name
]

{ #category : 'printing' }
TdHarnessChange >> printOn: aStream [

	aStream nextPutAll: self description
]

{ #category : 'initialization' }
TdHarnessChange >> setSubject: aSubject change: aChange name: aName before: anOldValue after: aNewValue [

	subject := aSubject.
	change := aChange.
	name := aName.
	before := anOldValue.
	after := aNewValue
]

{ #category : 'accessing' }
TdHarnessChange >> subject [
	"#section, #tool or #content."

	^ subject
]

{ #category : 'private' }
TdHarnessChange >> summaryOf: aValue [

	aValue ifNil: [ ^ '' ].
	aValue isString ifTrue: [ ^ TdText oneLine: aValue max: 100 ].
	aValue isDictionary ifTrue: [ ^ TdText oneLine: (aValue at: 'description' ifAbsent: [ '' ]) max: 100 ].
	^ TdText shorten: aValue printString to: 100
]

{ #category : 'accessing' }
TdHarnessChange >> symbol [
	"'+', '-' or '~'."

	change = #added ifTrue: [ ^ '+' ].
	change = #removed ifTrue: [ ^ '-' ].
	^ '~'
]
