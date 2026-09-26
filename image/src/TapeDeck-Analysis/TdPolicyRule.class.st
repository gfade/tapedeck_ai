"
I am one rule of a tool policy: a pattern that denies some tool calls. My subclasses say what the pattern is matched against. My label and reason follow the runner's tool_call gate (runner/harness/variant.ts): a blocked call is answered with 'Blocked by tapedeck policy: <label>'.
"
Class {
	#name : 'TdPolicyRule',
	#superclass : 'Object',
	#instVars : [
		'pattern'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'testing' }
TdPolicyRule class >> isAbstract [

	^ self == TdPolicyRule
]

{ #category : 'instance creation' }
TdPolicyRule class >> pattern: aJavaScriptRegex [

	^ self new setPattern: (TdPattern source: aJavaScriptRegex)
]

{ #category : 'testing' }
TdPolicyRule >> allows: aToolCall [

	^ (self denies: aToolCall) not
]

{ #category : 'testing' }
TdPolicyRule >> denies: aToolCall [

	^ self subclassResponsibility
]

{ #category : 'accessing' }
TdPolicyRule >> kindName [
	"The variant.json key my patterns come from."

	^ self subclassResponsibility
]

{ #category : 'accessing' }
TdPolicyRule >> label [
	"'denyCommands ^npm (test|run test)'"

	^ self kindName , ' ' , pattern source
]

{ #category : 'accessing' }
TdPolicyRule >> pattern [

	^ pattern
]

{ #category : 'printing' }
TdPolicyRule >> printOn: aStream [

	aStream nextPutAll: self label
]

{ #category : 'accessing' }
TdPolicyRule >> reason [
	"The text pi returns for a call I block."

	^ 'Blocked by tapedeck policy: ' , self label
]

{ #category : 'accessing' }
TdPolicyRule >> reasonFor: aToolCall [
	"My reason if I deny aToolCall, else nil."

	^ (self denies: aToolCall)
		  ifTrue: [ self reason ]
		  ifFalse: [ nil ]
]

{ #category : 'initialization' }
TdPolicyRule >> setPattern: aPattern [

	pattern := aPattern
]

{ #category : 'accessing' }
TdPolicyRule >> source [

	^ pattern source
]
