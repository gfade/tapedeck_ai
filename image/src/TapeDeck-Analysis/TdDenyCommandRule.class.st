"
I deny bash tool calls whose command matches my pattern anywhere (variant.json policy.denyCommands).

	(TdDenyCommandRule pattern: '^npm (test|run test)') denies: aToolCall
"
Class {
	#name : 'TdDenyCommandRule',
	#superclass : 'TdPolicyRule',
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'testing' }
TdDenyCommandRule >> denies: aToolCall [

	^ aToolCall isBash and: [ pattern search: aToolCall command ]
]

{ #category : 'accessing' }
TdDenyCommandRule >> kindName [

	^ 'denyCommands'
]
