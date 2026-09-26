"
I test TdVariant and TdForkRule: reading variant.json and finding where a fork should go live.
"
Class {
	#name : 'TdVariantTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdVariantTest >> taskRunnerVariant [

	^ TdVariant fromDictionary: (TdJson fromString:
			   '{"name":"rule-taskrunner","description":"Prompt rule","rules":["Run tests with ./tasks test."],"policy":{"denyCommands":["^npm (test|run test)"]},"fork":{"lenient":["system"],"at":{"tool":"bash","argMatches":{"command":"^npm "}}}}')
]

{ #category : 'tests' }
TdVariantTest >> testForkStepIsTheFirstNpmCall [

	| variant step |
	variant := self taskRunnerVariant.
	step := variant forkStepFor: self baseline.
	self assert: step index equals: 4.
	self assert: step == (self baseline stepAt: 4).
	self assert: (variant forkStepFor: self rerun) isNil.
	self assert: variant lenient equals: #( 'system' ).
	self assert: variant rules size equals: 1.
	self assert: variant name equals: 'rule-taskrunner'.
	self assert: (variant blockedCallsIn: self baseline) size equals: 1
]

{ #category : 'tests' }
TdVariantTest >> testToolPatternMatchesTheWholeName [

	| variant |
	variant := TdVariant fromDictionary:
		           (TdJson fromString: '{"name":"g","fork":{"at":{"tool":"edit|write","argMatches":{"path":"src/"}}}}').
	self assert: (variant forkStepFor: self baseline) response toolCalls first name equals: 'edit'.
	variant := TdVariant fromDictionary: (TdJson fromString: '{"name":"g","fork":{"at":{"tool":"dit"}}}').
	self assert: (variant forkStepFor: self baseline) isNil
]

{ #category : 'tests' }
TdVariantTest >> testVariantWithoutForkRule [

	| variant |
	variant := TdVariant named: 'vanilla'.
	self assert: (variant forkStepFor: self baseline) isNil.
	self assert: variant lenient isNil.
	self assert: variant policy isEmpty.
	self assert: variant rules isEmpty
]
